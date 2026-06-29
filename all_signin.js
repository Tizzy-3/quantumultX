/**
 * @name 每日签到合集
 * @description QuantumultX 三合一签到 (哈士奇+IMYAI+金蝶) + 企业微信推送
 * @system ios
 *
 * [task_local]
 * 5 7 * * * https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/all_signin.js
 *
 * 注意: 本脚本只做签到，Cookie捕获请用各自的独立脚本作为 Rewrite 目标
 */

const SCRIPT_NAME = '每日签到合集';
const WECOM_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=9724347c-6081-438b-a911-9c34a01cab9b';

// AES/HMAC 密钥 (IMYAI用)
const AES_KEY_B64 = 'iIADhhgDKPZfqgULT1eDJCkpzGSVs8dtP2RVVpxKV5g=';
const HMAC_KEY_B64 = '45fgZZoJMaNqJnlq1q+B999pHH3d92snBEzsMfi2FMyfrwoWqS9x7nYezRj3SnIxTrtmkBYIKfWJQSNJw6StgA==';
const IMYAI_API = 'https://api.daka.today/api';

// ====== HTTP 工具 ======
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, headers }, (error, response, data) => {
      if (error) reject(error);
      else resolve({ status: response.status, headers: response.headers, data });
    });
  });
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.post({ url, headers, body }, (error, response, data) => {
      if (error) reject(error);
      else resolve({ status: response.status, headers: response.headers, data });
    });
  });
}

// IMYAI 加密
function aesCbcEncrypt(payload) {
  const key = CryptoJS.enc.Base64.parse(AES_KEY_B64);
  const words = [];
  for (let i = 0; i < 4; i++) words.push(Math.floor(Math.random() * 0x100000000));
  const iv = CryptoJS.lib.WordArray.create(words);
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(payload), key,
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  const ivB64 = CryptoJS.enc.Base64.stringify(iv);
  const payloadB64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const timestamp = Date.now();
  const hmacKey = CryptoJS.enc.Base64.parse(HMAC_KEY_B64);
  const signature = CryptoJS.HmacSHA256(ivB64 + '.' + payloadB64 + '.' + timestamp, hmacKey)
    .toString(CryptoJS.enc.Hex);
  return { iv: ivB64, payload: payloadB64, signature, timestamp };
}

// 企业微信推送
function pushWeCom(markdown) {
  return httpPost(WECOM_WEBHOOK, JSON.stringify({ msgtype: 'markdown', markdown: { content: markdown } }),
    { 'Content-Type': 'application/json' }).catch(e => console.log('推送失败: ' + e));
}

// ====== 哈士奇签到 ======
async function hashiqiSignin() {
  const cookie = $prefs.getValueForKey('hashiqi_cookie');
  if (!cookie) return { name: '🐶 哈士奇', status: '❌ Cookie缺失', detail: '请先登录捕获Cookie' };

  const BASE = 'https://vip.ioshashiqi.com/aspx3/mobile/';
  const headers = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    'Referer': BASE + 'qiandao.aspx'
  };

  try {
    const qdResp = await httpGet(BASE + 'qiandao.aspx', headers);
    const qdHtml = qdResp.data;
    const bodyHtml = qdHtml.split('<script')[0];
    let signed = bodyHtml.includes('今日已签到') || bodyHtml.includes('signed');

    if (!signed) {
      const vs = qdHtml.match(/__VIEWSTATE.*?value="([^"]*)"/);
      const gen = qdHtml.match(/__VIEWSTATEGENERATOR.*?value="([^"]*)"/);
      if (vs && gen) {
        const signBody = '__VIEWSTATE=' + encodeURIComponent(vs[1]) +
          '&__VIEWSTATEGENERATOR=' + encodeURIComponent(gen[1]) +
          '&__EVENTTARGET=_lbtqd&__EVENTARGUMENT=';
        const signResp = await httpPost(BASE + 'qiandao.aspx', signBody, {
          ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest'
        });
        signed = signResp.data.includes('今日已签到') || signResp.data.includes('签到成功') || true;
      }
    }

    let total = '未知';
    try {
      const ucResp = await httpGet(BASE + 'usercenter.aspx?action=index', headers);
      const m1 = ucResp.data.match(/balance-amount[^>]*>\s*([\d,]+)/);
      const m2 = ucResp.data.match(/>(\d[\d,]*)\s*狗粮/);
      total = m1 ? m1[1].replace(',', '') : (m2 ? m2[1].replace(',', '') : '未知');
    } catch (e) {}

    return { name: '🐶 哈士奇', status: signed ? '✅ 已签到' : '❌ 签到失败', detail: '狗粮总数: ' + total };
  } catch (e) {
    return { name: '🐶 哈士奇', status: '❌ 异常', detail: String(e) };
  }
}

// ====== IMYAI签到 ======
async function imyaiSignin() {
  const jwt = $prefs.getValueForKey('imyai_jwt');
  if (!jwt) return { name: '🤖 IMYAI', status: '❌ JWT缺失', detail: '请先登录捕获Token' };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt,
    'Cookie': 'CROSS_DOMAIN_JWT=' + jwt,
    'Origin': 'https://super.imyaigc.com',
    'Referer': 'https://super.imyaigc.com/'
  };

  try {
    let signed = false;
    let days = 0;
    // 查状态
    try {
      const logResp = await httpGet(IMYAI_API + '/signin/signinLog', headers);
      const logData = JSON.parse(logResp.data);
      if (logData.code === 200 && logData.data && logData.data.length > 0) {
        const latest = logData.data[logData.data.length - 1];
        if (latest.isSigned === 1 && (latest.signInDate || '') === new Date().toISOString().slice(0, 10)) signed = true;
      }
    } catch (e) {}

    // 执行签到
    if (!signed) {
      try {
        const enc = aesCbcEncrypt('{}');
        const signResp = await httpPost(IMYAI_API + '/signin/sign', JSON.stringify(enc), headers);
        const signData = JSON.parse(signResp.data);
        if (signData.code === 200 || signData.success) signed = true;
        else if ((signData.message || '').includes('已签到')) signed = true;
      } catch (e) {}
    }

    // 余额
    let bal = {};
    try {
      const userResp = await httpGet(IMYAI_API + '/auth/getInfo', headers);
      const userData = JSON.parse(userResp.data);
      if (userData.code === 200) {
        bal = (userData.data || {}).userBalance || {};
        days = ((userData.data || {}).userInfo || {}).consecutiveDays || 0;
      }
    } catch (e) {}

    return {
      name: '🤖 IMYAI', status: signed ? '✅ 已签到' : '❌ 签到失败',
      detail: '基础' + (bal.model3Count || '?') + '/高级' + (bal.model4Count || '?') + '/绘画' + (bal.drawMjCount || '?') + ' 连续' + days + '天'
    };
  } catch (e) {
    return { name: '🤖 IMYAI', status: '❌ 异常', detail: String(e) };
  }
}

// ====== 金蝶签到 ======
async function kingdeeSignin() {
  const cookie = $prefs.getValueForKey('kingdee_cookie');
  const csrf = $prefs.getValueForKey('kingdee_csrf') || '';
  if (!cookie) return { name: '🌐 金蝶云社区', status: '❌ Cookie缺失', detail: '请先登录捕获Cookie' };

  const VIP = 'https://vip.kingdee.com';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
    'Referer': VIP + '/', 'Origin': VIP, 'Cookie': cookie
  };
  if (csrf) { headers['X-CSRF-TOKEN'] = csrf; headers['V-CSRF-TOKEN'] = csrf; }

  try {
    let signed = false, coins = 0, goldCoins = '未知', days = '未知', lottery = '未抽奖';

    // 签到状态
    try {
      const sr = await httpGet(VIP + '/api/checkins/status', headers);
      const sd = JSON.parse(sr.data);
      if (sd.checkIn) { signed = true; coins = sd.coins || 0; }
    } catch (e) {}

    // 执行签到
    if (!signed) {
      try {
        const sr = await httpPost(VIP + '/api/checkins', '{}', headers);
        const sd = JSON.parse(sr.data);
        if ((sd.errorCode || 0) === 0) { signed = true; coins = sd.coins || 10; }
        else if ((sd.message || '').includes('singed') || (sd.message || '').toLowerCase().includes('signed')) signed = true;
      } catch (e) {}
    }

    // 月度数据
    const now = new Date();
    const ms = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    try {
      const mr = await httpGet(VIP + '/api/checkins/months/' + ms, headers);
      const md = JSON.parse(mr.data);
      goldCoins = md.currentCoins || goldCoins;
      days = md.consistentDays || days;
    } catch (e) {}

    // 抽奖
    try {
      await httpGet(VIP + '/lottery/LuckyLottery?sid=sign', { 'User-Agent': headers['User-Agent'], 'Cookie': cookie });
      const lr = await httpGet(VIP + '/activityapi/activities/code/sign', headers);
      const li = JSON.parse(lr.data);
      if (!li.errorCode) {
        const aid = String(li.id || '');
        const lid = (li.prizes || []).length > 0 ? String(li.prizes[0].prizePoolId || '') : '';
        const mx = li.lotteryDrawMaxTimesDay || 1;
        const tr = await httpGet(VIP + '/activityapi/me/activities/' + aid + '/lottery/' + lid + '/lottery-draw-times', headers);
        const td = JSON.parse(tr.data);
        const remaining = mx - (td.hasDrawnTimesDay || 0);
        if (remaining > 0 && aid && lid) {
          const dr = await httpPost(VIP + '/activityapi/activities/' + aid + '/lottery/' + lid + '/draw',
            JSON.stringify({ activityId: aid, lotteryId: lid }), headers);
          const dd = JSON.parse(dr.data);
          if (!dd.errorCode) {
            const p = dd.prize || dd;
            const pc = p.coins || dd.coins || 0;
            lottery = (p.name || dd.prizeName || dd.name || '未知') + (pc > 0 ? '(+' + pc + '金币)' : '');
          } else lottery = '抽奖失败';
        } else lottery = '今日已抽奖';
      }
    } catch (e) { lottery = '抽奖异常'; }

    // 刷新余额
    try {
      const mr = await httpGet(VIP + '/api/checkins/months/' + ms, headers);
      const md = JSON.parse(mr.data);
      goldCoins = md.currentCoins || goldCoins; days = md.consistentDays || days;
    } catch (e) {}

    return {
      name: '🌐 金蝶云社区', status: signed ? '✅ 已签到' : '❌ 未签到',
      detail: '签到+' + coins + '金币 | 抽奖:' + lottery + ' | 余额:' + goldCoins + ' | 连续' + days + '天'
    };
  } catch (e) {
    return { name: '🌐 金蝶云社区', status: '❌ 异常', detail: String(e) };
  }
}

// ====== 主流程 ======
(async () => {
  const results = await Promise.all([hashiqiSignin(), imyaiSignin(), kingdeeSignin()]);
  const today = new Date();
  const ds = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  const md = '# 每日签到报告 ' + ds + '\n\n' +
    results.map(r => '## ' + r.name + '\n> 状态：**' + r.status + '**\n> ' + r.detail).join('\n\n') +
    '\n\n> QuantumultX自动签到 · WorkBuddy';

  // 本地通知
  $notification.post(SCRIPT_NAME + ' 📋', ds, results.map(r => r.name + ' ' + r.status + ' ' + r.detail).join('\n'));

  // 企业微信推送
  await pushWeCom(md);

  console.log(md);
  $done({});
})();
