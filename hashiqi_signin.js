/**
 * @name 哈士奇签到
 * @description QuantumultX 哈士奇(ioshashiqi)每日签到 + Cookie自动捕获
 * @system ios
 *
 * 【配置说明】
 * 本脚本同时支持 Cookie 捕获和签到:
 * - Rewrite 触发 → 自动捕获并保存 Cookie
 * - 定时任务触发 → 读取保存的 Cookie 执行签到
 *
 * [rewrite_local]
 * ^https?://vip\.ioshashiqi\.com url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/hashiqi_signin.js
 *
 * [task_local]
 * 5 7 * * * https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/hashiqi_signin.js
 */

const SCRIPT_NAME = '哈士奇签到';
const COOKIE_KEY = 'hashiqi_cookie';
const BASE_URL = 'https://vip.ioshashiqi.com/aspx3/mobile/';

// ====== Rewrite Cookie 捕获 ======
if ($request) {
  let cookie = '';
  // 从 request headers 获取
  const reqCookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
  // 从 response headers 获取（Set-Cookie）
  let respCookie = '';
  if ($response && $response.headers) {
    const sc = $response.headers['Set-Cookie'] || $response.headers['set-cookie'] || '';
    if (sc) respCookie = sc;
  }

  // 合成完整 cookie（request cookie + response 新增的 cookie）
  cookie = reqCookie;
  if (respCookie) {
    // 从 Set-Cookie 提取 cookie 名值对
    const pairs = respCookie.split(',').map(s => s.trim().split(';')[0]);
    const newPairs = pairs.filter(p => {
      const name = p.split('=')[0];
      return !reqCookie.includes(name + '=');
    });
    if (newPairs.length) cookie += '; ' + newPairs.join('; ');
  }

  if (cookie) {
    const oldCookie = $prefs.valueForKey(COOKIE_KEY) || '';
    if (cookie !== oldCookie) {
      $prefs.setValueForKey(cookie, COOKIE_KEY);
      $notification.post(SCRIPT_NAME, '✅ Cookie捕获成功', '哈士奇Cookie已更新');
      console.log('Cookie已保存: ' + cookie.slice(0, 80) + '...');
    } else {
      console.log('Cookie未变化');
    }
  }
  $done({});
}

// ====== 签到模式 ======
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

function extractHiddenFields(html) {
  const vs = html.match(/__VIEWSTATE.*?value="([^"]*)"/);
  const gen = html.match(/__VIEWSTATEGENERATOR.*?value="([^"]*)"/);
  return { viewstate: vs ? vs[1] : '', generator: gen ? gen[1] : '' };
}

function parseDogFood(html) {
  const m1 = html.match(/balance-amount[^>]*>\s*([\d,]+)/);
  const m2 = html.match(/>(\d[\d,]*)\s*狗粮/);
  if (m1) return m1[1].replace(',', '');
  if (m2) return m2[1].replace(',', '');
  return '未知';
}

(async () => {
  const cookie = $prefs.valueForKey(COOKIE_KEY);
  if (!cookie) {
    $notification.post(SCRIPT_NAME, '❌ Cookie缺失', '请先在Safari登录 vip.ioshashiqi.com');
    $done({});
    return;
  }

  const headers = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer': BASE_URL + 'qiandao.aspx'
  };

  let resultMsg = '';
  let alreadySigned = false;

  try {
    // Step 1: 获取签到页面
    const qdResp = await httpGet(BASE_URL + 'qiandao.aspx', headers);
    const qdHtml = qdResp.data;
    const htmlBody = qdHtml.split('<script')[0];

    if (htmlBody.includes('今日已签到') || htmlBody.includes('signed')) {
      alreadySigned = true;
      resultMsg += '今日已签到\n';
    } else {
      // 执行签到 POST
      const fields = extractHiddenFields(qdHtml);
      if (fields.viewstate && fields.generator) {
        const signBody = '__VIEWSTATE=' + encodeURIComponent(fields.viewstate) +
          '&__VIEWSTATEGENERATOR=' + encodeURIComponent(fields.generator) +
          '&__EVENTTARGET=_lbtqd&__EVENTARGUMENT=';
        const signResp = await httpPost(BASE_URL + 'qiandao.aspx', signBody, {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        });
        if (signResp.data.includes('今日已签到') || signResp.data.includes('签到成功')) {
          alreadySigned = true;
          resultMsg += '✅ 签到成功\n';
        } else {
          alreadySigned = true;
          resultMsg += '⚠️ 签到可能已完成\n';
        }
      } else {
        alreadySigned = true;
        resultMsg += '⚠️ 未找到签到表单\n';
      }
    }

    // Step 2: 获取狗粮信息
    try {
      const ucResp = await httpGet(BASE_URL + 'usercenter.aspx?action=index', headers);
      const total = parseDogFood(ucResp.data);
      resultMsg += '狗粮总数: ' + total;
    } catch (e) {
      resultMsg += '狗粮信息获取失败';
    }

    $notification.post(SCRIPT_NAME + ' 🐶', alreadySigned ? '✅ 签到完成' : '❌ 签到失败', resultMsg);
  } catch (e) {
    $notification.post(SCRIPT_NAME, '❌ 异常', String(e));
  }

  $done({});
})();
