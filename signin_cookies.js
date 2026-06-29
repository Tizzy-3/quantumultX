/**
 * @name 签到Cookie捕获合集
 * @description QuantumultX Rewrite Cookie捕获脚本 (哈士奇+IMYAI+金蝶云社区)
 * @system ios
 *
 * 【配置方法】
 * 在 QuantumultX 的 [rewrite_local] 中添加:
 *
 * # 哈士奇 - 捕获登录Cookie
 * ^https?://vip\.ioshashiqi\.com url script-response-header signin_cookies.js
 *
 * # IMYAI - 捕获JWT Token
 * ^https?://(super\.imyaigc\.com|api\.imyaigc\.com|api\.daka\.today) url script-response-header signin_cookies.js
 *
 * # 金蝶云社区 - 捕获VIP Cookie + CSRF Token
 * ^https?://vip\.kingdee\.com url script-response-header signin_cookies.js
 *
 * 在 [task_local] 中添加:
 * 5 7 * * * all_signin.js
 */

// ====== 哈士奇 Cookie 捕获 ======
if ($request.url.includes('ioshashiqi.com')) {
  const cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
  if (cookie) {
    const old = $prefs.getValueForKey('hashiqi_cookie') || '';
    if (cookie !== old) {
      $prefs.setValueForKey(cookie, 'hashiqi_cookie');
      $notification.post('哈士奇Cookie', '✅ 捕获成功', 'Cookie已更新');
      console.log('哈士奇Cookie已保存');
    }
  }
}

// ====== IMYAI JWT 捕获 ======
if ($request.url.includes('imyaigc.com') || $request.url.includes('daka.today')) {
  let jwt = '';
  // 从 Authorization header
  const authHeader = $request.headers['Authorization'] || $request.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    jwt = authHeader.substring(7);
  }
  // 从 Cookie 中的 CROSS_DOMAIN_JWT
  if (!jwt) {
    const cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
    const m = cookie.match(/CROSS_DOMAIN_JWT=([^;]+)/);
    if (m) jwt = m[1];
  }
  // 从 response body
  if (!jwt && $response) {
    try {
      const body = JSON.parse($response.body || '');
      if (body.data && body.data.token) jwt = body.data.token;
    } catch (e) {}
  }

  if (jwt) {
    const old = $prefs.getValueForKey('imyai_jwt') || '';
    if (jwt !== old) {
      $prefs.setValueForKey(jwt, 'imyai_jwt');
      $notification.post('IMYAI JWT', '✅ 捕获成功', 'Token已更新');
      console.log('IMYAI JWT已保存');
    }
  }
}

// ====== 金蝶云社区 Cookie + CSRF 捕获 ======
if ($request.url.includes('kingdee.com')) {
  const cookie = $request.headers['Cookie'] || $request.headers['cookie'] || '';
  if (cookie) {
    const old = $prefs.getValueForKey('kingdee_cookie') || '';
    if (cookie !== old) {
      $prefs.setValueForKey(cookie, 'kingdee_cookie');
      console.log('金蝶Cookie已保存');
    }
  }

  // 提取 CSRF Token (从 Set-Cookie 或 response header)
  let csrf = '';
  if ($response && $response.headers) {
    // 从 Set-Cookie
    const setCookie = $response.headers['Set-Cookie'] || $response.headers['set-cookie'] || '';
    const csrfMatch = setCookie.match(/V-CSRF-TOKEN=([^;]+)/);
    if (csrfMatch) csrf = csrfMatch[1];

    // 从 response header
    const csrfHeader = $response.headers['V-CSRF-TOKEN'] || $response.headers['X-CSRF-TOKEN'] || '';
    if (csrfHeader) csrf = csrfHeader;
  }

  if (csrf) {
    const old = $prefs.getValueForKey('kingdee_csrf') || '';
    if (csrf !== old) {
      $prefs.setValueForKey(csrf, 'kingdee_csrf');
      $notification.post('金蝶CSRF', '✅ 捕获成功', 'CSRF Token已更新');
      console.log('金蝶CSRF已保存');
    }
  }

  // 保存完整Cookie
  if (cookie) {
    $notification.post('金蝶Cookie', '✅ 捕获成功', 'Cookie已更新');
  }
}

$done({});
