/**
 * @name 金蝶云社区签到
 * @description QuantumultX 金蝶云社区(vip.kingdee.com)每日签到+抽奖 + Cookie/CSRF自动捕获
 * @system ios
 *
 * 【配置说明】
 * 本脚本同时支持 Cookie/CSRF 捕获和签到抽奖:
 * - Rewrite 触发 → 自动捕获并保存 Cookie + CSRF Token
 * - 定时任务触发 → 读取保存的认证信息执行签到+抽奖
 *
 * [rewrite_local]
 * ^https?://vip\.kingdee\.com url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/kingdee_signin.js
 *
 * [task_local]
 * 7 7 * * * https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/kingdee_signin.js
 */

const SCRIPT_NAME = '金蝶云社区签到';
const COOKIE_KEY = 'kingdee_cookie';
const CSRF_KEY = 'kingdee_csrf';
const VIP_BASE = 'https://vip.kingdee.com';

// ====== Rewrite Cookie + CSRF 捕获 ======
if ($request) {
  // 捕获 Cookie
  let cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';

  // 合并 response Set-Cookie
  if ($response && $response.headers) {
    const setCookie = $response.headers['Set-Cookie'] || $response.headers['set-cookie'] || '';
    if (setCookie && cookie) {
      const pairs = setCookie.split(',').map(s => s.trim().split(';')[0]);
      const newPairs = pairs.filter(p => !cookie.includes(p.split('=')[0] + '='));
      if (newPairs.length) cookie += '; ' + newPairs.join('; ');
    } else if (setCookie && !cookie) {
      cookie = setCookie.split(',').map(s => s.trim().split(';')[0]).join('; ');
    }

    // 提取 CSRF Token
    const csrfFromCookie = setCookie.match(/V-CSRF-TOKEN=([^;]+)/);
    const csrfFromHeader = $response.headers['V-CSRF-TOKEN'] || $response.headers['X-CSRF-TOKEN'] || '';
    const csrf = csrfFromCookie ? csrfFromCookie[1] : csrfFromHeader;

    if (csrf) {
      $prefs.setValueForKey(csrf, CSRF_KEY);
      console.log('CSRF已保存: ' + csrf.slice(0, 20) + '...');
    }
  }

  if (cookie) {
    const old = $prefs.getValueForKey(COOKIE_KEY) || '';
    if (cookie !== old) {
      $prefs.setValueForKey(cookie, COOKIE_KEY);
      $notification.post(SCRIPT_NAME, '✅ Cookie捕获成功', '金蝶Cookie已更新');
      console.log('Cookie已保存');
    }
  }
  $done({});
}

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

// ====== 签到主流程 ======
(async () => {
  const cookie = $prefs.getValueForKey(COOKIE_KEY);
  const csrf = $prefs.getValueForKey(CSRF_KEY) || '';

  if (!cookie) {
    $notification.post(SCRIPT_NAME, '❌ Cookie缺失', '请先登录 vip.kingdee.com');
    $done({});
    return;
  }

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

  let alreadySigned = false;
  let todayCoins = 0;
  let goldCoins = '未知';
  let consecutiveDays = '未知';
  let lotteryText = '未抽奖';
  let resultParts = [];

  try {
    // Step 1: 检查签到状态
    try {
      const statusResp = await httpGet(VIP_BASE + '/api/checkins/status', apiHeaders);
      const statusData = JSON.parse(statusResp.data);
      if (statusData.checkIn) {
        alreadySigned = true;
        todayCoins = statusData.coins || 0;
      }
    } catch (e) {
      if (e === '401' || (e.response && e.response.status === 401)) {
        $notification.post(SCRIPT_NAME, '❌ Cookie已过期', '请重新登录 vip.kingdee.com');
        $done({});
        return;
      }
    }

    // Step 2: 执行签到
    if (!alreadySigned) {
      try {
        const signResp = await httpPost(VIP_BASE + '/api/checkins', '{}', apiHeaders);
        const signData = JSON.parse(signResp.data);
        if ((signData.errorCode || 0) === 0) {
          alreadySigned = true;
          todayCoins = signData.coins || 10;
        } else {
          const msg = signData.message || '';
          if (msg.includes('singed') || msg.toLowerCase().includes('signed') || msg.includes('已签到')) {
            alreadySigned = true;
          }
        }
      } catch (e) {}
    }

    // Step 3: 月度数据
    const now = new Date();
    const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    try {
      const monthResp = await httpGet(VIP_BASE + '/api/checkins/months/' + monthStr, apiHeaders);
      const md = JSON.parse(monthResp.data);
      goldCoins = md.currentCoins || goldCoins;
      consecutiveDays = md.consistentDays || consecutiveDays;
    } catch (e) {}

    // Step 4: 签到抽奖
    try {
      await httpGet(VIP_BASE + '/lottery/LuckyLottery?sid=sign', { 'User-Agent': apiHeaders['User-Agent'], 'Cookie': cookie });

      const lotteryResp = await httpGet(VIP_BASE + '/activityapi/activities/code/sign', apiHeaders);
      const lotteryInfo = JSON.parse(lotteryResp.data);

      if (!lotteryInfo.errorCode) {
        const activityId = String(lotteryInfo.id || '');
        const prizes = lotteryInfo.prizes || [];
        const lotteryId = prizes.length > 0 ? String(prizes[0].prizePoolId || '') : '';
        const maxDay = lotteryInfo.lotteryDrawMaxTimesDay || 1;

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
            const name = prize.name || drawData.prizeName || drawData.name || '未知';
            const coins = prize.coins || drawData.coins || 0;
            lotteryText = coins > 0 ? name + '(+' + coins + '金币)' : name;
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

    // Step 5: 刷新金币
    try {
      const monthResp = await httpGet(VIP_BASE + '/api/checkins/months/' + monthStr, apiHeaders);
      const md = JSON.parse(monthResp.data);
      goldCoins = md.currentCoins || goldCoins;
      consecutiveDays = md.consistentDays || consecutiveDays;
    } catch (e) {}

    // 汇总
    resultParts = [
      alreadySigned ? '✅ 已签到' : '❌ 未签到',
      todayCoins > 0 ? '签到+' + todayCoins + '金币' : '',
      '抽奖: ' + lotteryText,
      '余额: ' + goldCoins + '金币',
      '连续' + consecutiveDays + '天'
    ].filter(l => l);

    $notification.post(SCRIPT_NAME + ' 🌐', alreadySigned ? '✅ 签到完成' : '❌ 签到失败', resultParts.join(' | '));
  } catch (e) {
    $notification.post(SCRIPT_NAME, '❌ 异常', String(e));
  }

  $done({});
})();
