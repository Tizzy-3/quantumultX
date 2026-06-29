/**
 * @name 每日签到合集
 * @description QuantumultX 三合一签到脚本 (哈士奇+IMYAI+金蝶云社区) + 企业微信推送
 * @system ios
 *
 * 【定时任务配置】
 * [task_local]
 * 5 7 * * * all_signin.js
 *
 * 依赖:
 * - hashiqi_cookie (Rewrite捕获)
 * - imyai_jwt (Rewrite捕获)
 * - kingdee_cookie + kingdee_csrf (Rewrite捕获)
 */

const SCRIPT_NAME = '每日签到合集';
const WECOM_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=9724347c-6081-438b-a911-9c34a01cab9b';

// ====== HTTP 工具 ======
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, headers }, (error, response, data) => {
      if (error) reject(error);
      else resolve({ status: response.status, headers: response.headers, data });
    });
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    $httpClient.post({ url, headers, body }, (error, response, data) => {
      if (error) reject(error);
      else resolve({ status: response.status, headers: response.headers, data });
    });
  });
}

// ====== CryptoJS 加密 (IMYAI用) ======
const AES_KEY_B64 = 'iIADhhgDKPZfqgULT1eDJCkpzGSVs8dtP2RVVpxKV5g=';
const HMAC_KEY_B64 = '45fgZZoJMaNqJnlq1q+B999pHH3d92snBEzsMfi2FMyfrwoWqS9x7nYezRj3SnIxTrtmkBYIKfWJQSNJw6StgA==';
const IMYAI_API = 'https://api.daka.today/api';

function base64Decode(str) {
  return CryptoJS.enc.Base64.parse(str);
}

function aesCbcEncrypt(payload, aesKeyB64) {
  const key = base64Decode(aesKeyB64 || AES_KEY_B64);
  const words = [];
  for (let i = 0; i < 4; i++) words.push(Math.floor(Math.random() * 0x100000000));
  const iv = CryptoJS.lib.WordArray.create(words);

  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(payload),
    key,
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );

  const ivB64 = CryptoJS.enc.Base64.stringify(iv);
  const payloadB64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const timestamp = Date.now();
  const hmacKey = base64Decode(HMAC_KEY_B64);
  const sigMessage = ivB64 + '.' + payloadB64 + '.' + timestamp;
  const signature = CryptoJS.HmacSHA256(sigMessage, hmacKey).toString(CryptoJS.enc.Hex);

  return { iv: ivB64, payload: payloadB64, signature: signature, timestamp: timestamp };
}

// ====== 推送企业微信 ======
function pushWeCom(title, content) {
  const payload = JSON.stringify({
    msgtype: 'markdown',
    markdown: { content: content }
  }, null, 2);

  return httpPost(WECOM_WEBHOOK, payload, {
    'Content-Type': 'application/json'
  }).then(r => {
    console.log('企业微信推送: ' + r.data.slice(0, 100));
  }).catch(e => {
    console.log('推送失败: ' + e);
  });
}

// ====== 各签到模块 ======

// 1. 哈士奇签到
async function hashiqiSignin() {
  const cookie = $prefs.getValueForKey('hashiqi_cookie');
  if (!cookie) return { name: '🐶 哈士奇', status: '❌ Cookie缺失', detail: '请先登录捕获Cookie' };

  const BASE_URL = 'https://vip.ioshashiqi.com/aspx3/mobile/';
  const headers = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer': BASE_URL + 'qiandao.aspx'
  };

  try {
    // 获取签到页面
    const qdResp = await httpGet(BASE_URL + 'qiandao.aspx', headers);
    const qdHtml = qdResp.data;
    const htmlBeforeScript = qdHtml.split('<script')[0];

    let alreadySigned = htmlBeforeScript.includes('今日已签到') || htmlBeforeScript.includes('class="signin-btn signed"');

    if (!alreadySigned) {
      // 提取 __VIEWSTATE
      const vsMatch = qdHtml.match(/__VIEWSTATE.*?value="([^"]*)"/);
      const genMatch = qdHtml.match(/__VIEWSTATEGENERATOR.*?value="([^"]*)"/);
      if (vsMatch && genMatch) {
        const signBody = [
          '__VIEWSTATE=' + encodeURIComponent(vsMatch[1]),
          '__VIEWSTATEGENERATOR=' + encodeURIComponent(genMatch[1]),
          '__EVENTTARGET=_lbtqd',
          '__EVENTARGUMENT='
        ].join('&');

        const signResp = await httpPost(BASE_URL + 'qiandao.aspx', signBody, {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        });
        alreadySigned = true;
      }
    }

    // 获取狗粮信息
    let totalDogfood = '未知';
    try {
      const ucResp = await httpGet(BASE_URL + 'usercenter.aspx?action=index', headers);
      const m1 = ucResp.data.match(/balance-amount[^>]*>\s*([\d,]+)/);
      const m2 = ucResp.data.match(/>(\d[\d,]*)\s*狗粮/);
      totalDogfood = (m1 ? m1[1].replace(',', '') : (m2 ? m2[1].replace(',', '') : '未知'));
    } catch (e) {}

    return {
      name: '🐶 哈士奇',
      status: alreadySigned ? '✅ 已签到' : '❌ 签到失败',
      detail: `狗粮总数: ${totalDogfood}`
    };
  } catch (e) {
    return { name: '🐶 哈士奇', status: '❌ 异常', detail: String(e) };
  }
}

// 2. IMYAI签到
async function imyaiSignin() {
  const jwt = $prefs.getValueForKey('imyai_jwt');
  if (!jwt) return { name: '🤖 IMYAI', status: '❌ JWT缺失', detail: '请先登录捕获Token' };

  const apiHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt,
    'Cookie': 'CROSS_DOMAIN_JWT=' + jwt,
    'Origin': 'https://super.imyaigc.com',
    'Referer': 'https://super.imyaigc.com/'
  };

  try {
    // 查询签到状态
    let alreadySigned = false;
    let consecutiveDays = 0;
    try {
      const logResp = await httpGet(IMYAI_API + '/signin/signinLog', apiHeaders);
      const logData = JSON.parse(logResp.data);
      if (logData.code === 200) {
        const logs = logData.data;
        if (logs && logs.length > 0) {
          const latest = logs[logs.length - 1];
          const today = new Date().toISOString().slice(0, 10);
          if (latest.isSigned === 1 && (latest.signInDate || '') === today) {
            alreadySigned = true;
          }
        }
      }
    } catch (e) {}

    // 执行签到
    if (!alreadySigned) {
      const encryptedBody = aesCbcEncrypt('{}', AES_KEY_B64);
      const signResp = await httpPost(IMYAI_API + '/signin/sign', JSON.stringify(encryptedBody), apiHeaders);
      const signData = JSON.parse(signResp.data);
      if (signData.code === 200 || signData.success) {
        alreadySigned = true;
      } else if (signData.message && signData.message.includes('已签到')) {
        alreadySigned = true;
      }
    }

    // 获取余额
    let balance = {};
    try {
      const userResp = await httpGet(IMYAI_API + '/auth/getInfo', apiHeaders);
      const userData = JSON.parse(userResp.data);
      if (userData.code === 200) {
        balance = (userData.data || {}).userBalance || {};
        consecutiveDays = ((userData.data || {}).userInfo || {}).consecutiveDays || 0;
      }
    } catch (e) {}

    return {
      name: '🤖 IMYAI',
      status: alreadySigned ? '✅ 已签到' : '❌ 签到失败',
      detail: `基础${balance.model3Count || '?'} / 高级${balance.model4Count || '?'} / 绘画${balance.drawMjCount || '?'} (连续${consecutiveDays}天)`
    };
  } catch (e) {
    return { name: '🤖 IMYAI', status: '❌ 异常', detail: String(e) };
  }
}

// 3. 金蝶云社区签到
async function kingdeeSignin() {
  const cookie = $prefs.getValueForKey('kingdee_cookie');
  const csrf = $prefs.getValueForKey('kingdee_csrf') || '';
  if (!cookie) return { name: '🌐 金蝶云社区', status: '❌ Cookie缺失', detail: '请先登录捕获Cookie' };

  const VIP_BASE = 'https://vip.kingdee.com';
  const apiHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': VIP_BASE + '/',
    'Origin': VIP_BASE,
    'Cookie': cookie
  };
  if (csrf) {
    apiHeaders['X-CSRF-TOKEN'] = csrf;
    apiHeaders['V-CSRF-TOKEN'] = csrf;
  }

  try {
    // 检查签到状态
    let alreadySigned = false;
    let todayCoins = 0;
    try {
      const statusResp = await httpGet(VIP_BASE + '/api/checkins/status', apiHeaders);
      const statusData = JSON.parse(statusResp.data);
      if (statusData.checkIn) {
        alreadySigned = true;
        todayCoins = statusData.coins || 0;
      }
    } catch (e) {}

    // 执行签到
    if (!alreadySigned) {
      try {
        const signResp = await httpPost(VIP_BASE + '/api/checkins', '{}', apiHeaders);
        const signData = JSON.parse(signResp.data);
        if ((signData.errorCode || 0) === 0) {
          alreadySigned = true;
          todayCoins = signData.coins || 10;
        }
      } catch (e) {}
    }

    // 月度数据
    let goldCoins = '未知', consecutiveDays = '未知';
    const now = new Date();
    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    try {
      const monthResp = await httpGet(VIP_BASE + '/api/checkins/months/' + monthStr, apiHeaders);
      const monthData = JSON.parse(monthResp.data);
      goldCoins = monthData.currentCoins || goldCoins;
      consecutiveDays = monthData.consistentDays || consecutiveDays;
    } catch (e) {}

    // 签到抽奖
    let lotteryText = '未抽奖';
    try {
      await httpGet(VIP_BASE + '/lottery/LuckyLottery?sid=sign', { 'User-Agent': apiHeaders['User-Agent'], 'Cookie': cookie });
      const lotteryResp = await httpGet(VIP_BASE + '/activityapi/activities/code/sign', apiHeaders);
      const lotteryInfo = JSON.parse(lotteryResp.data);
      if (!lotteryInfo.errorCode) {
        const activityId = String(lotteryInfo.id || '');
        const prizes = lotteryInfo.prizes || [];
        const lotteryId = prizes.length > 0 ? String(prizes[0].prizePoolId || '') : '';
        const maxDay = lotteryInfo.lotteryDrawMaxTimesDay || 1;

        // 查询抽奖次数
        const timesResp = await httpGet(
          VIP_BASE + '/activityapi/me/activities/' + activityId + '/lottery/' + lotteryId + '/lottery-draw-times',
          apiHeaders
        );
        const timesData = JSON.parse(timesResp.data);
        const drawnToday = timesData.hasDrawnTimesDay || 0;
        const remaining = maxDay - drawnToday;

        if (remaining > 0 && activityId && lotteryId) {
          const drawResp = await httpPost(
            VIP_BASE + '/activityapi/activities/' + activityId + '/lottery/' + lotteryId + '/draw',
            JSON.stringify({ activityId, lotteryId }),
            apiHeaders
          );
          const drawData = JSON.parse(drawResp.data);
          if (!drawData.errorCode) {
            const prize = drawData.prize || drawData;
            const prizeName = prize.name || drawData.prizeName || drawData.name || '未知';
            const prizeCoins = prize.coins || drawData.coins || 0;
            lotteryText = prizeCoins > 0 ? `${prizeName}(+${prizeCoins}金币)` : prizeName;
          } else {
            lotteryText = '抽奖失败';
          }
        } else {
          lotteryText = '今日已抽奖';
        }
      }
    } catch (e) {
      lotteryText = '抽奖异常';
    }

    // 刷新金币
    try {
      const monthResp = await httpGet(VIP_BASE + '/api/checkins/months/' + monthStr, apiHeaders);
      const monthData = JSON.parse(monthResp.data);
      goldCoins = monthData.currentCoins || goldCoins;
      consecutiveDays = monthData.consistentDays || consecutiveDays;
    } catch (e) {}

    return {
      name: '🌐 金蝶云社区',
      status: alreadySigned ? '✅ 已签到' : '❌ 签到失败',
      detail: `签到+${todayCoins}金币 | 抽奖: ${lotteryText} | 余额: ${goldCoins} | 连续${consecutiveDays}天`
    };
  } catch (e) {
    return { name: '🌐 金蝶云社区', status: '❌ 异常', detail: String(e) };
  }
}

// ====== 主流程 ======
(async () => {
  console.log('===== 每日签到合集开始 =====');

  const results = [];
  const [r1, r2, r3] = await Promise.all([
    hashiqiSignin(),
    imyaiSignin(),
    kingdeeSignin()
  ]);
  results.push(r1, r2, r3);

  // 构造汇总信息
  const today = new Date();
  const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  const summaryLines = results.map(r => `## ${r.name}\n> 状态：**${r.status}**\n> ${r.detail}`);
  const markdown = `# 每日签到报告 ${dateStr}\n\n${summaryLines.join('\n\n')}\n\n> QuantumultX自动签到 · WorkBuddy`;

  // 本地通知
  const notifyBody = results.map(r => r.name + ' ' + r.status + ' ' + r.detail).join('\n');
  $notification.post(SCRIPT_NAME + ' 📋', dateStr, notifyBody);

  // 推送企业微信
  await pushWeCom(SCRIPT_NAME, markdown);

  console.log('===== 签到合集完成 =====');
  console.log(markdown);

  $done({});
})();
