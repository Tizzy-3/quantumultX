/**
 * @name IMYAI签到
 * @description QuantumultX IMYAI每日签到 + JWT自动捕获（AES-256-CBC加密+HMAC-SHA256签名）
 * @system ios
 *
 * 【配置说明】
 * 本脚本同时支持 JWT 捕获和签到:
 * - Rewrite 触发 → 自动捕获并保存 JWT Token
 * - 定时任务触发 → 读取保存的 JWT 执行签到
 *
 * [rewrite_local]
 * ^https?://(super\.imyaigc\.com|api\.imyaigc\.com|api\.daka\.today) url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/imyai_signin.js
 *
 * [task_local]
 * 6 7 * * * https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/imyai_signin.js
 */

const SCRIPT_NAME = 'IMYAI签到';
const JWT_KEY = 'imyai_jwt';

// AES/HMAC 密钥
const AES_KEY_B64 = 'iIADhhgDKPZfqgULT1eDJCkpzGSVs8dtP2RVVpxKV5g=';
const HMAC_KEY_B64 = '45fgZZoJMaNqJnlq1q+B999pHH3d92snBEzsMfi2FMyfrwoWqS9x7nYezRj3SnIxTrtmkBYIKfWJQSNJw6StgA==';
const API_BASE = 'https://api.daka.today/api';

// ====== Rewrite JWT 捕获 ======
if ($request) {
  let jwt = '';
  // 从 Authorization header
  const auth = $request.headers['Authorization'] || $request.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) jwt = auth.substring(7);
  // 从 Cookie
  if (!jwt) {
    const cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
    const m = cookie.match(/CROSS_DOMAIN_JWT=([^;]+)/);
    if (m) jwt = m[1];
  }
  // 从 response body
  if (!jwt && $response) {
    try {
      const body = JSON.parse($response.body || '{}');
      if (body.data && body.data.token) jwt = body.data.token;
    } catch (e) {}
  }

  if (jwt) {
    const old = $prefs.getValueForKey(JWT_KEY) || '';
    if (jwt !== old) {
      $prefs.setValueForKey(jwt, JWT_KEY);
      $notification.post(SCRIPT_NAME, '✅ JWT捕获成功', 'Token已更新');
      console.log('JWT已保存');
    } else {
      console.log('JWT未变化');
    }
  }
  $done({});
}

// ====== CryptoJS 加密 ======
function aesCbcEncrypt(payload) {
  const key = CryptoJS.enc.Base64.parse(AES_KEY_B64);
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
  const hmacKey = CryptoJS.enc.Base64.parse(HMAC_KEY_B64);
  const signature = CryptoJS.HmacSHA256(ivB64 + '.' + payloadB64 + '.' + timestamp, hmacKey)
    .toString(CryptoJS.enc.Hex);

  return { iv: ivB64, payload: payloadB64, signature, timestamp };
}

// ====== HTTP 工具 ======
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, headers }, (error, response, data) => {
      if (error) reject(error);
      else resolve({ status: response.status, data });
    });
  });
}

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    $httpClient.post({ url, headers, body }, (error, response, data) => {
      if (error) reject(error);
      else resolve({ status: response.status, data });
    });
  });
}

// ====== 签到主流程 ======
(async () => {
  const jwt = $prefs.getValueForKey(JWT_KEY);
  if (!jwt) {
    $notification.post(SCRIPT_NAME, '❌ JWT缺失', '请先微信扫码登录 super.imyaigc.com');
    $done({});
    return;
  }

  const apiHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt,
    'Cookie': 'CROSS_DOMAIN_JWT=' + jwt,
    'Origin': 'https://super.imyaigc.com',
    'Referer': 'https://super.imyaigc.com/'
  };

  let resultMsg = '';
  let consecutiveDays = 0;

  try {
    // 查询签到状态
    let alreadySigned = false;
    try {
      const logResp = await httpGet(API_BASE + '/signin/signinLog', apiHeaders);
      const logData = JSON.parse(logResp.data);
      if (logData.code === 200 && logData.data && logData.data.length > 0) {
        const latest = logData.data[logData.data.length - 1];
        const today = new Date().toISOString().slice(0, 10);
        if (latest.isSigned === 1 && (latest.signInDate || '') === today) {
          alreadySigned = true;
        }
      }
    } catch (e) {
      console.log('查询状态失败: ' + e);
    }

    // 执行签到
    if (!alreadySigned) {
      try {
        const enc = aesCbcEncrypt('{}');
        const signResp = await httpPost(API_BASE + '/signin/sign', JSON.stringify(enc), apiHeaders);
        const signData = JSON.parse(signResp.data);
        if (signData.code === 200 || signData.success) {
          alreadySigned = true;
          resultMsg += '✅ 签到成功\n';
        } else {
          const msg = signData.message || '';
          if (msg.includes('已签到')) {
            alreadySigned = true;
            resultMsg += 'ℹ️ 今日已签到\n';
          } else {
            resultMsg += '⚠️ 签到失败: ' + msg + '\n';
          }
        }
      } catch (e) {
        resultMsg += '❌ 签到异常: ' + e + '\n';
      }
    } else {
      resultMsg += 'ℹ️ 今日已签到\n';
    }

    // 获取余额
    try {
      const userResp = await httpGet(API_BASE + '/auth/getInfo', apiHeaders);
      const userData = JSON.parse(userResp.data);
      if (userData.code === 200) {
        const bal = (userData.data || {}).userBalance || {};
        consecutiveDays = ((userData.data || {}).userInfo || {}).consecutiveDays || 0;
        resultMsg += '积分: 基础' + (bal.model3Count || '?') +
          '/ 高级' + (bal.model4Count || '?') +
          '/ 绘画' + (bal.drawMjCount || '?') +
          '\n连续' + consecutiveDays + '天';
      }
    } catch (e) {
      resultMsg += '余额获取失败';
    }

    $notification.post(SCRIPT_NAME + ' 🤖', alreadySigned ? '✅ 签到完成' : '❌ 签到失败', resultMsg);
  } catch (e) {
    $notification.post(SCRIPT_NAME, '❌ 异常', String(e));
  }

  $done({});
})();
