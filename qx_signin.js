/*
 * Quantumult X daily sign-in runner.
 *
 * Tasks:
 * - Hashiqi mobile check-in with username/password.
 * - IMYAI check-in with JWT and encrypted request payload.
 * - Kingdee VIP check-in + lottery with existing cookies.
 * - Optional WeCom markdown report push.
 *
 * Quantumult X task example:
 * 0 8 * * * https://example.com/qx_signin.js, tag=Daily Sign-in, img-url=checkmark.seal.system
 */

const USER_CONFIG = {
  HASHIQI_COOKIE: "",
  HASHIQI_USERNAME: "",
  HASHIQI_PASSWORD: "",
  IMYAI_JWT: "",
  KINGDEE_COOKIE: "",
  KINGDEE_CSRF_TOKEN: "",
  WECOM_WEBHOOK_URL: "",

  // Leave this enabled unless your Quantumult X runtime already provides CryptoJS.
  CRYPTOJS_URL: "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js",
  KINGDEE_PRODUCT_LINE_ID: "1",
};

const IMYAI_AES_KEY_B64 = "iIADhhgDKPZfqgULT1eDJCkpzGSVs8dtP2RVVpxKV5g=";
const IMYAI_HMAC_KEY_B64 = "45fgZZoJMaNqJnlq1q+B999pHH3d92snBEzsMfi2FMyfrwoWqS9x7nYezRj3SnIxTrtmkBYIKfWJQSNJw6StgA==";

const HASHIQI_BASE = "https://vip.ioshashiqi.com/aspx3/mobile";
const IMYAI_API_BASE = "https://api.daka.today/api";
const KINGDEE_VIP_BASE = "https://vip.kingdee.com";

const state = {
  cookieJars: {
    hashiqi: {},
  },
  lines: [],
};

main()
  .then(async () => {
    const report = buildReport(state.lines);
    await pushWeCom(report);
    notify(`每日签到报告 ${todayString()}`, "签到完成", buildNotificationBody(state.lines));
    done();
  })
  .catch(async (error) => {
    const message = error && error.stack ? error.stack : String(error);
    state.lines.push({ id: "runner", title: "运行器", status: "失败", error: message });
    const report = buildReport(state.lines);
    await pushWeCom(report);
    notify(`每日签到报告 ${todayString()}`, "运行失败", buildNotificationBody(state.lines));
    done();
  });

async function main() {
  await runStep("hashiqi", signHashiqi);
  await runStep("imyai", signImyai);
  await runStep("kingdee", signKingdee);
}

async function runStep(name, fn) {
  try {
    const result = await fn();
    state.lines.push(Object.assign({ id: name }, result));
  } catch (error) {
    state.lines.push({
      id: name,
      status: "失败",
      error: error && error.message ? error.message : String(error),
    });
  }
}

async function signHashiqi() {
  const savedCookie = config("HASHIQI_COOKIE");
  const username = config("HASHIQI_USERNAME");
  const password = config("HASHIQI_PASSWORD");
  if (savedCookie) {
    state.cookieJars.hashiqi = parseCookieString(savedCookie);
  } else if (!username || !password) {
    return skipped("🐶 哈士奇签到", "未获取 HASHIQI_COOKIE，也未配置账号密码");
  }

  const loginUrl = `${HASHIQI_BASE}/login.aspx`;
  if (!savedCookie) {
    const loginPage = await request({
      url: loginUrl,
      method: "GET",
      jar: state.cookieJars.hashiqi,
    });
    const viewstate = match(loginPage.body, /__VIEWSTATE[^>]+value="([^"]+)"/i);
    const generator = match(loginPage.body, /__VIEWSTATEGENERATOR[^>]+value="([^"]+)"/i);
    if (!viewstate || !generator) {
      throw new Error("Hashiqi login page did not include VIEWSTATE fields");
    }

    await request({
      url: loginUrl,
      method: "POST",
      jar: state.cookieJars.hashiqi,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://vip.ioshashiqi.com",
        Referer: loginUrl,
      },
      body: formEncode({
        __VIEWSTATE: viewstate,
        __VIEWSTATEGENERATOR: generator,
        __EVENTTARGET: "btnLogin",
        __EVENTARGUMENT: "",
        txtUser_sign_in: username,
        txtPwd_sign_in: password,
      }),
    });
  }

  const qiandaoUrl = `${HASHIQI_BASE}/qiandao.aspx`;
  const qiandao = await request({
    url: qiandaoUrl,
    method: "GET",
    jar: state.cookieJars.hashiqi,
    headers: { Referer: loginUrl },
  });

  const signedBefore = containsAny(qiandao.body, ["今日已签到", "class=\"signin-btn signed\""]);
  let signed = signedBefore;
  let reward = "";

  if (!signedBefore) {
    const qdViewstate = match(qiandao.body, /__VIEWSTATE[^>]+value="([^"]+)"/i);
    const qdGenerator = match(qiandao.body, /__VIEWSTATEGENERATOR[^>]+value="([^"]+)"/i);
    if (qdViewstate && qdGenerator) {
      const signResult = await request({
        url: qiandaoUrl,
        method: "POST",
        jar: state.cookieJars.hashiqi,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: qiandaoUrl,
        },
        body: formEncode({
          __VIEWSTATE: qdViewstate,
          __VIEWSTATEGENERATOR: qdGenerator,
          __EVENTTARGET: "_lbtqd",
          __EVENTARGUMENT: "",
        }),
      });
      signed = containsAny(signResult.body, ["今日已签到", "签到成功", "signed"]);
    } else {
      signed = true;
    }
  }

  const userCenter = await request({
    url: `${HASHIQI_BASE}/usercenter.aspx?action=index`,
    method: "GET",
    jar: state.cookieJars.hashiqi,
    headers: { Referer: qiandaoUrl },
  });
  const total = match(userCenter.body, /balance-amount[^>]*>\s*([\d,]+)/i) ||
    match(userCenter.body, />(\d[\d,]*)\s*狗粮/);
  const rewardMatch = match(userCenter.body.slice(0, 3000), /奖励.*?(\d+)/);
  reward = rewardMatch || "75";

  return {
    title: "🐶 哈士奇签到",
    status: signed ? "成功" : "未知",
    reward: `+${reward}`,
    total: total || "未知",
  };
}

async function signImyai() {
  const jwt = config("IMYAI_JWT");
  if (!jwt) {
    return skipped("🤖 IMYAI签到", "未获取 IMYAI_JWT，请重新登录 IMYAI");
  }
  await ensureCryptoJS();

  const headers = {
    "User-Agent": userAgent(),
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
    Cookie: `CROSS_DOMAIN_JWT=${jwt}`,
    Origin: "https://super.imyaigc.com",
    Referer: "https://super.imyaigc.com/",
  };

  let before = null;
  let signedBefore = false;
  let consecutiveDays = 0;
  try {
    const info = await requestJson({ url: `${IMYAI_API_BASE}/auth/getInfo`, method: "GET", headers });
    before = info && info.data ? info.data : null;
    consecutiveDays = before && before.userInfo ? valueOf(before.userInfo.consecutiveDays, 0) : 0;
  } catch (error) {
    // The sign endpoint can still work even if getInfo is unavailable.
  }

  try {
    const log = await requestJson({ url: `${IMYAI_API_BASE}/signin/signinLog`, method: "GET", headers });
    const list = Array.isArray(log.data) ? log.data : [];
    const latest = list.length ? list[list.length - 1] : null;
    signedBefore = !!(latest && latest.isSigned === 1 && latest.signInDate === todayString());
  } catch (error) {
    // Treat log lookup as advisory.
  }

  let signStatus = signedBefore ? "Already signed" : "Signed";
  if (!signedBefore) {
    const body = JSON.stringify(encryptImyaiPayload({}));
    try {
      const signResult = await requestJson({
        url: `${IMYAI_API_BASE}/signin/sign`,
        method: "POST",
        headers,
        body,
      });
      if (!(signResult.code === 200 || signResult.success)) {
        const msg = signResult.message || JSON.stringify(signResult).slice(0, 180);
        if (/已签|already|signed/i.test(msg)) {
          signStatus = "Already signed";
        } else {
          throw new Error(msg);
        }
      }
    } catch (error) {
      if (/已签|already|signed|400/.test(String(error))) {
        signStatus = "Already signed";
      } else {
        throw error;
      }
    }
  }

  let balance = before && before.userBalance ? before.userBalance : {};
  try {
    const after = await requestJson({ url: `${IMYAI_API_BASE}/auth/getInfo`, method: "GET", headers });
    balance = after && after.data && after.data.userBalance ? after.data.userBalance : balance;
    consecutiveDays = after && after.data && after.data.userInfo ? valueOf(after.data.userInfo.consecutiveDays, consecutiveDays) : consecutiveDays;
  } catch (error) {
    // Keep the earlier balance if the refresh fails.
  }

  return {
    title: `🤖 IMYAI签到（连续${consecutiveDays}天）`,
    status: signStatus === "Signed" || signStatus === "Already signed" ? "已签到" : signStatus,
    todayReward: "基础+50 / 高级+5 / 绘画+5",
    points: `基础${valueOf(balance.model3Count, "未知")} / 高级${valueOf(balance.model4Count, "未知")} / 绘画${valueOf(balance.drawMjCount, "未知")}`,
  };
}

async function signKingdee() {
  const cookie = config("KINGDEE_COOKIE");
  if (!cookie) {
    return skipped("🌐 金蝶云社区签到", "未获取 KINGDEE_COOKIE，请重新登录金蝶云社区");
  }
  const csrf = config("KINGDEE_CSRF_TOKEN") || match(cookie, /(?:^|;\s*)V-CSRF-TOKEN=([^;]+)/);
  const productLineId = config("KINGDEE_PRODUCT_LINE_ID") || "1";
  const headers = {
    "User-Agent": userAgent(),
    Cookie: cookie,
    "X-CSRF-TOKEN": csrf || "",
    "V-CSRF-TOKEN": csrf || "",
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${KINGDEE_VIP_BASE}/`,
    Origin: KINGDEE_VIP_BASE,
    currentProductLineId: productLineId,
    "Content-Type": "application/json",
  };

  const month = `${KINGDEE_VIP_BASE}/api/checkins/months/${monthString()}`;
  let coins = "unknown";
  let days = "unknown";
  try {
    const monthResult = await requestJson({ url: month, method: "GET", headers });
    coins = valueOf(monthResult.currentCoins, coins);
    days = valueOf(monthResult.consistentDays, days);
  } catch (error) {
    // Keep going; cookie may still be good enough for status.
  }

  let status = "Signed";
  let todayCoins = 0;
  try {
    const check = await requestJson({ url: `${KINGDEE_VIP_BASE}/api/checkins/status`, method: "GET", headers });
    if (check.checkIn) {
      status = "Already signed";
      todayCoins = valueOf(check.coins, 0);
    } else {
      const sign = await requestJson({
        url: `${KINGDEE_VIP_BASE}/api/checkins`,
        method: "POST",
        headers,
        body: "{}",
      });
      if (sign.errorCode && !/signed|已签/i.test(sign.message || "")) {
        throw new Error(sign.message || JSON.stringify(sign).slice(0, 180));
      }
      todayCoins = valueOf(sign.coins, todayCoins);
    }
  } catch (error) {
    if (/401/.test(String(error))) {
      throw new Error("Kingdee cookie expired or unauthorized");
    }
    if (/409|signed|已签/i.test(String(error))) {
      status = "Already signed";
    } else {
      throw error;
    }
  }

  const lottery = await runKingdeeLottery(headers);
  try {
    const monthResult = await requestJson({ url: month, method: "GET", headers });
    coins = valueOf(monthResult.currentCoins, coins);
    days = valueOf(monthResult.consistentDays, days);
  } catch (error) {
    // Non-critical refresh.
  }

  return {
    title: `🌐 金蝶云社区签到（连续${days}天）`,
    status: status === "Signed" || status === "Already signed" ? "已签到" : status,
    todayCoins: `+${todayCoins}`,
    lottery: formatKingdeeLottery(lottery),
    totalCoins: coins,
  };
}

async function runKingdeeLottery(headers) {
  try {
    await request({
      url: `${KINGDEE_VIP_BASE}/lottery/LuckyLottery?sid=sign`,
      method: "GET",
      headers,
    });
  } catch (error) {
    // This page warms the activity session; continue if it fails.
  }

  try {
    const activity = await requestJson({
      url: `${KINGDEE_VIP_BASE}/activityapi/activities/code/sign`,
      method: "GET",
      headers,
    });
    if (activity.errorCode) {
      return `activity failed: ${activity.message || activity.errorCode}`;
    }

    const activityId = String(activity.id || "731");
    const prizes = Array.isArray(activity.prizes) ? activity.prizes : [];
    const lotteryId = prizes.length ? String(prizes[0].prizePoolId || prizes[0].lotteryId || "") : "";
    if (!lotteryId) {
      return "no lottery id";
    }

    const maxDay = Number(activity.lotteryDrawMaxTimesDay || 1);
    const times = await requestJson({
      url: `${KINGDEE_VIP_BASE}/activityapi/me/activities/${activityId}/lottery/${lotteryId}/lottery-draw-times`,
      method: "GET",
      headers,
    });
    const drawnToday = Number(times.hasDrawnTimesDay || 0);
    if (maxDay - drawnToday > 0) {
      const draw = await requestJson({
        url: `${KINGDEE_VIP_BASE}/activityapi/activities/${activityId}/lottery/${lotteryId}/draw`,
        method: "POST",
        headers,
        body: JSON.stringify({ activityId, lotteryId }),
      });
      if (draw.errorCode) {
        return `draw failed: ${draw.message || draw.errorCode}`;
      }
      const prize = draw.prize || draw;
      const name = prize.name || draw.prizeName || "unknown prize";
      const coins = Number(prize.coins || draw.coins || 0);
      return coins > 0 ? `${name} (+${coins})` : name;
    }

    const records = await requestJson({
      url: `${KINGDEE_VIP_BASE}/activityapi/me/activities/${activityId}/lottery-draw-records?page=0&pageSize=5`,
      method: "GET",
      headers,
    });
    const today = todayString();
    const list = Array.isArray(records.content) ? records.content : [];
    const found = list.find((item) => timestampDate(item.createdAt) === today);
    if (!found) {
      return "already drawn";
    }
    const prize = found.prize || {};
    const name = prize.name || "unknown prize";
    const coins = Number(prize.coins || 0);
    return coins > 0 ? `already drew ${name} (+${coins})` : `already drew ${name}`;
  } catch (error) {
    return `error: ${error.message || String(error)}`;
  }
}

async function pushWeCom(markdown) {
  const webhook = config("WECOM_WEBHOOK_URL");
  if (!webhook) {
    return;
  }
  try {
    await request({
      url: webhook,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content: markdown },
      }),
    });
  } catch (error) {
    notify("Daily Sign-in", "WeCom push failed", error.message || String(error));
  }
}

function buildReport(lines) {
  const date = todayString();
  return [`每日签到报告 ${date}`]
    .concat(lines.map(formatReportItem))
    .join("\n");
}

function buildNotificationBody(lines) {
  return lines.map(formatReportItem).join("\n");
}

function formatReportItem(item) {
  if (item.id === "hashiqi") {
    return [
      item.title || "🐶 哈士奇签到",
      `状态：${item.status || "未知"}`,
      `获得狗粮：${item.reward || "未知"}`,
      `狗粮总数：${item.total || "未知"}`,
    ].join("\n");
  }
  if (item.id === "imyai") {
    return [
      item.title || "🤖 IMYAI签到",
      `状态：${item.status || "未知"}`,
      `今日获得：${item.todayReward || "基础+50 / 高级+5 / 绘画+5"}`,
      `当前积分：${item.points || "未知"}`,
    ].join("\n");
  }
  if (item.id === "kingdee") {
    return [
      item.title || "🌐 金蝶云社区签到",
      `状态：${item.status || "未知"}`,
      `今日获得：${item.todayCoins || "未知"} 金币`,
      `抽奖获得：${item.lottery || "未知"}`,
      `当前金币：${item.totalCoins || "未知"}`,
    ].join("\n");
  }
  return [
    item.title || item.id || "任务",
    `状态：${item.status || "未知"}`,
    item.error || item.detail || "",
  ].filter(Boolean).join("\n");
}

function formatKingdeeLottery(lotteryText) {
  const text = String(lotteryText || "");
  const coins = match(text, /\(\+(\d+)\)/) || match(text, /\+(\d+)/) || match(text, /(\d+)\s*金币/);
  if (coins) {
    return `+${coins} 金币`;
  }
  if (/already drawn|今日已抽|已抽/.test(text)) {
    return "今日已抽奖";
  }
  if (/error|异常|failed|失败/i.test(text)) {
    return "抽奖异常";
  }
  return text || "未知";
}

async function ensureCryptoJS() {
  if (typeof CryptoJS !== "undefined") {
    return;
  }
  const cacheKey = "QX_SIGNIN_CRYPTOJS_CACHE";
  const cached = pref(cacheKey);
  if (cached) {
    globalEval(cached);
    if (typeof CryptoJS !== "undefined") {
      return;
    }
  }
  const url = config("CRYPTOJS_URL");
  if (!url) {
    throw new Error("CryptoJS is required for IMYAI encryption");
  }
  const response = await request({ url, method: "GET" });
  if (!response.body || response.body.length < 1000) {
    throw new Error("failed to load CryptoJS");
  }
  setPref(cacheKey, response.body);
  globalEval(response.body);
  if (typeof CryptoJS === "undefined") {
    throw new Error("CryptoJS loaded but global CryptoJS was not found");
  }
}

function encryptImyaiPayload(data) {
  const aesKey = CryptoJS.enc.Base64.parse(IMYAI_AES_KEY_B64);
  const hmacKey = CryptoJS.enc.Base64.parse(IMYAI_HMAC_KEY_B64);
  const iv = CryptoJS.lib.WordArray.random(16);
  const plaintext = CryptoJS.enc.Utf8.parse(JSON.stringify(data));
  const encrypted = CryptoJS.AES.encrypt(plaintext, aesKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const ivB64 = CryptoJS.enc.Base64.stringify(iv);
  const payloadB64 = CryptoJS.enc.Base64.stringify(encrypted.ciphertext);
  const timestamp = Date.now();
  const signature = CryptoJS.HmacSHA256(`${ivB64}.${payloadB64}.${timestamp}`, hmacKey).toString(CryptoJS.enc.Hex);
  return {
    iv: ivB64,
    payload: payloadB64,
    signature,
    timestamp,
  };
}

async function requestJson(options) {
  const response = await request(options);
  try {
    return JSON.parse(response.body || "{}");
  } catch (error) {
    throw new Error(`invalid JSON from ${options.url}: ${(response.body || "").slice(0, 200)}`);
  }
}

function request(options) {
  const opts = Object.assign({ method: "GET", headers: {} }, options);
  opts.headers = Object.assign({ "User-Agent": userAgent() }, opts.headers || {});
  if (opts.jar) {
    const cookie = cookieHeader(opts.jar);
    if (cookie) {
      opts.headers.Cookie = cookie;
    }
  }
  const fetchOptions = Object.assign({}, opts);
  delete fetchOptions.jar;
  return new Promise((resolve, reject) => {
    const task = typeof $task !== "undefined" ? $task : null;
    if (!task || typeof task.fetch !== "function") {
      reject(new Error("This script must run in Quantumult X or a compatible $task.fetch environment"));
      return;
    }
    task.fetch(fetchOptions).then((response) => {
      if (opts.jar) {
        storeCookies(opts.jar, response.headers || {});
      }
      const status = Number(response.statusCode || response.status || 0);
      if (status >= 400) {
        reject(new Error(`HTTP ${status} from ${opts.url}: ${(response.body || "").slice(0, 240)}`));
        return;
      }
      resolve(response);
    }, reject);
  });
}

function storeCookies(jar, headers) {
  const setCookie = headerValue(headers, "set-cookie");
  if (!setCookie) {
    return;
  }
  const entries = Array.isArray(setCookie) ? setCookie : splitSetCookie(String(setCookie));
  entries.forEach((entry) => {
    const first = String(entry).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) {
      jar[first.slice(0, index).trim()] = first.slice(index + 1).trim();
    }
  });
}

function splitSetCookie(value) {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((x) => x.trim()).filter(Boolean);
}

function cookieHeader(jar) {
  return Object.keys(jar).map((key) => `${key}=${jar[key]}`).join("; ");
}

function parseCookieString(cookie) {
  const jar = {};
  String(cookie || "").split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index > 0) {
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) {
        jar[key] = value;
      }
    }
  });
  return jar;
}

function headerValue(headers, name) {
  const lower = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return "";
}

function config(key) {
  const fromPrefs = pref(`QX_SIGNIN_${key}`);
  if (fromPrefs) {
    return fromPrefs;
  }
  const legacyKey = legacyPrefKey(key);
  if (legacyKey) {
    const fromLegacyPrefs = pref(legacyKey);
    if (fromLegacyPrefs) {
      return fromLegacyPrefs;
    }
  }
  return USER_CONFIG[key] || "";
}

function legacyPrefKey(key) {
  const map = {
    HASHIQI_COOKIE: "hashiqi_cookie",
    IMYAI_JWT: "imyai_jwt",
    KINGDEE_COOKIE: "kingdee_cookie",
    KINGDEE_CSRF_TOKEN: "kingdee_csrf",
  };
  return map[key] || "";
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
      $prefs.setValueForKey(value, key);
    }
  } catch (error) {
    // Ignore cache write failures.
  }
}

function formEncode(data) {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join("&");
}

function containsAny(text, needles) {
  return needles.some((needle) => String(text || "").includes(needle));
}

function match(text, regex) {
  const found = regex.exec(String(text || ""));
  return found ? found[1] : "";
}

function skipped(title, reason) {
  return { title, status: "未配置", error: reason };
}

function valueOf(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback === undefined ? 0 : fallback;
  }
  return value;
}

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthString() {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function timestampDate(value) {
  if (!value) {
    return "";
  }
  let ms = Number(value);
  if (ms < 1000000000000) {
    ms *= 1000;
  }
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function userAgent() {
  return "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 QuantumultX";
}

function notify(title, subtitle, body) {
  if (typeof $notify !== "undefined") {
    $notify(title, subtitle || "", body || "");
  }
}

function done(value) {
  if (typeof $done !== "undefined") {
    $done(value || {});
  }
}

function globalEval(source) {
  (0, eval)(source);
}
