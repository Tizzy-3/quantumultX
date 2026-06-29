/*
 * Quantumult X request-header script for capturing sign-in credentials.
 *
 * Use with rewrite_local + MITM. After you log in to the websites, this
 * script stores cookies/tokens in $prefs for qx_signin.js.
 */

const PREFIX = "QX_SIGNIN_";

capture();

function capture() {
  try {
    const req = typeof $request !== "undefined" ? $request : null;
    if (!req || !req.url) {
      return finish("No request object");
    }

    const url = parseUrl(req.url);
    const host = (url.hostname || "").toLowerCase();
    const headers = normalizeHeaders(req.headers || {});
    const cookie = headers.cookie || "";
    const authorization = headers.authorization || "";

    const saved = [];
    if (host === "vip.ioshashiqi.com" && cookie) {
      save("HASHIQI_COOKIE", cookie, saved);
    }

    if ((host === "api.daka.today" || host === "super.imyaigc.com") && (authorization || cookie)) {
      const jwt = extractJwt(authorization, cookie);
      if (jwt) {
        save("IMYAI_JWT", jwt, saved);
      }
    }

    if (host === "vip.kingdee.com" && cookie) {
      save("KINGDEE_COOKIE", cookie, saved);
      const csrf = headers["x-csrf-token"] ||
        headers["v-csrf-token"] ||
        extractCookieValue(cookie, "V-CSRF-TOKEN");
      if (csrf) {
        save("KINGDEE_CSRF_TOKEN", csrf, saved);
      }
      const productLineId = headers.currentproductlineid || extractCookieValue(cookie, "vip-club-product-line-id");
      if (productLineId) {
        save("KINGDEE_PRODUCT_LINE_ID", productLineId, saved);
      }
    }

    if (saved.length) {
      notify("签到凭证已更新", host, saved.join(", "));
    }
    finish();
  } catch (error) {
    notify("签到凭证捕获失败", "", error.message || String(error));
    finish();
  }
}

function save(key, value, saved) {
  const prefKey = `${PREFIX}${key}`;
  if (setPref(prefKey, value)) {
    saved.push(key);
  }
}

function extractJwt(authorization, cookie) {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(authorization || "").trim());
  if (bearer && bearer[1]) {
    return bearer[1].trim();
  }
  return extractCookieValue(cookie, "CROSS_DOMAIN_JWT") ||
    extractCookieValue(cookie, "jwt") ||
    extractCookieValue(cookie, "token");
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

function parseUrl(url) {
  const matched = /^https?:\/\/([^\/?#]+)([\/?#]|$)/i.exec(String(url || ""));
  return { hostname: matched ? matched[1] : "" };
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
