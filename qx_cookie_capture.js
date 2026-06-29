/*
 * Quantumult X response-header script for capturing sign-in credentials.
 *
 * Use with rewrite_local + MITM. After you log in to the websites, this
 * script stores cookies/tokens in $prefs for qx_signin.js.
 */

const PREFIX = "QX_SIGNIN_";
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

capture();

function capture() {
  try {
    const req = typeof $request !== "undefined" ? $request : null;
    if (!req || !req.url) {
      return finish("No request object");
    }

    const res = typeof $response !== "undefined" ? $response : null;
    const url = parseUrl(req.url);
    const host = (url.hostname || "").toLowerCase();
    const reqHeaders = normalizeHeaders(req.headers || {});
    const resHeaders = normalizeHeaders((res && res.headers) || {});
    const requestCookie = reqHeaders.cookie || "";
    const responseSetCookie = resHeaders["set-cookie"] || "";
    const mergedCookie = mergeCookies(requestCookie, responseSetCookie);
    const authorization = reqHeaders.authorization || "";

    const saved = [];
    if (host === "vip.ioshashiqi.com" && mergedCookie) {
      save("HASHIQI_COOKIE", mergedCookie, saved);
      notifyIfSaved(saved, "哈士奇", "获取cookies成功", "HASHIQI_COOKIE");
    }

    if (host === "api.daka.today" || host === "api.imyaigc.com" || host === "super.imyaigc.com") {
      const jwt = extractJwt(authorization, mergedCookie, res && res.body);
      if (jwt) {
        save("IMYAI_JWT", jwt, saved);
        notifyIfSaved(saved, "IMYAI", "获取token成功", "IMYAI_JWT");
      }
    }

    if (host === "vip.kingdee.com" && mergedCookie) {
      save("KINGDEE_COOKIE", mergedCookie, saved);
      const csrf = reqHeaders["x-csrf-token"] ||
        reqHeaders["v-csrf-token"] ||
        resHeaders["x-csrf-token"] ||
        resHeaders["v-csrf-token"] ||
        extractCookieValue(mergedCookie, "V-CSRF-TOKEN");
      if (csrf) {
        save("KINGDEE_CSRF_TOKEN", csrf, saved);
      }
      const productLineId = reqHeaders.currentproductlineid || extractCookieValue(mergedCookie, "vip-club-product-line-id");
      if (productLineId) {
        save("KINGDEE_PRODUCT_LINE_ID", productLineId, saved);
      }
      notifyIfSaved(saved, "金蝶云社区", "获取cookies成功", "KINGDEE_COOKIE");
    }

    finish();
  } catch (error) {
    notify("签到凭证捕获失败", "", error.message || String(error));
    finish();
  }
}

function save(key, value, saved) {
  const prefKey = `${PREFIX}${key}`;
  const oldValue = normalizeStoredValue(key, pref(prefKey));
  const newValue = normalizeStoredValue(key, value);
  if (newValue && newValue !== oldValue && setPref(prefKey, newValue)) {
    saved.push(key);
  }
}

function notifyIfSaved(saved, title, subtitle, primaryKey) {
  if (saved.includes(primaryKey) && shouldNotify(primaryKey)) {
    notify(title, subtitle, "");
  }
}

function shouldNotify(key) {
  const now = Date.now();
  const notifyKey = `${PREFIX}${key}_LAST_NOTIFY_AT`;
  const last = Number(pref(notifyKey) || 0);
  if (last && now - last < NOTIFY_COOLDOWN_MS) {
    return false;
  }
  setPref(notifyKey, String(now));
  return true;
}

function normalizeStoredValue(key, value) {
  if (!value) {
    return "";
  }
  if (key.includes("COOKIE")) {
    return stableCookieString(value);
  }
  return String(value);
}

function stableCookieString(cookie) {
  const jar = {};
  parseCookieHeader(cookie).forEach(([key, value]) => {
    if (!volatileCookieName(key)) {
      jar[key] = value;
    }
  });
  return Object.keys(jar).sort().map((key) => `${key}=${jar[key]}`).join("; ");
}

function volatileCookieName(name) {
  return /^(_ga|_gid|_gat|Hm_|HMACCOUNT|sensors|acw_tc|aliyungf_tc|SERVERID|route|SESSION_REFRESH|csrf_refresh)/i.test(name);
}

function extractJwt(authorization, cookie, responseBody) {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(authorization || "").trim());
  if (bearer && bearer[1]) {
    return bearer[1].trim();
  }
  const fromCookie = extractCookieValue(cookie, "CROSS_DOMAIN_JWT") ||
    extractCookieValue(cookie, "jwt") ||
    extractCookieValue(cookie, "token");
  if (fromCookie) {
    return fromCookie;
  }
  try {
    const body = JSON.parse(responseBody || "{}");
    return body.token ||
      body.jwt ||
      (body.data && (body.data.token || body.data.jwt || body.data.accessToken)) ||
      "";
  } catch (error) {
    return "";
  }
}

function extractCookieValue(cookie, name) {
  const parts = String(cookie || "").split(";");
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    if (key === name) {
      return part.slice(index + 1).trim();
    }
  }
  return "";
}

function normalizeHeaders(headers) {
  const output = {};
  Object.keys(headers || {}).forEach((key) => {
    output[key.toLowerCase()] = headers[key];
  });
  return output;
}

function mergeCookies(requestCookie, responseSetCookie) {
  const jar = {};
  parseCookieHeader(requestCookie).forEach(([key, value]) => {
    jar[key] = value;
  });
  parseSetCookieHeader(responseSetCookie).forEach(([key, value]) => {
    jar[key] = value;
  });
  return Object.keys(jar).map((key) => `${key}=${jar[key]}`).join("; ");
}

function parseCookieHeader(cookie) {
  return String(cookie || "")
    .split(";")
    .map((part) => cookiePair(part))
    .filter(Boolean);
}

function parseSetCookieHeader(setCookie) {
  const raw = Array.isArray(setCookie) ? setCookie : splitSetCookie(String(setCookie || ""));
  return raw
    .map((entry) => cookiePair(String(entry).split(";")[0]))
    .filter(Boolean);
}

function splitSetCookie(value) {
  if (!value) {
    return [];
  }
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function cookiePair(part) {
  const index = String(part || "").indexOf("=");
  if (index <= 0) {
    return null;
  }
  const key = part.slice(0, index).trim();
  const value = part.slice(index + 1).trim();
  return key ? [key, value] : null;
}

function parseUrl(url) {
  const matched = /^https?:\/\/([^\/?#]+)([\/?#]|$)/i.exec(String(url || ""));
  return { hostname: matched ? matched[1] : "" };
}

function pref(key) {
  try {
    if (typeof $prefs !== "undefined" && $prefs.valueForKey) {
      return $prefs.valueForKey(key) || "";
    }
  } catch (error) {
    return "";
  }
  return "";
}

function setPref(key, value) {
  try {
    if (typeof $prefs !== "undefined" && $prefs.setValueForKey) {
      return $prefs.setValueForKey(String(value), key);
    }
  } catch (error) {
    return false;
  }
  return false;
}

function notify(title, subtitle, body) {
  if (typeof $notify !== "undefined") {
    $notify(title, subtitle || "", body || "");
  }
}

function finish(message) {
  if (message) {
    console.log(message);
  }
  if (typeof $done !== "undefined") {
    $done({});
  }
}
