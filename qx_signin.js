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
  IMYAI_AES_KEY_B64: "iIADhhgDKPZfqgULT1eDJCkpzGSVs8dtP2RVVpxKV5g=",
  IMYAI_HMAC_KEY_B64: "45fgZZoJMaNqJnlq1q+B999pHH3d92snBEzsMfi2FMyfrwoWqS9x7nYezRj3SnIxTrtmkBYIKfWJQSNJw6StgA==",
  DEBUG: "false",
  REQUEST_TIMEOUT_MS: "10000",
  REQUEST_RETRIES: "2",

  // Leave this enabled unless your Quantumult X runtime already provides CryptoJS.
  CRYPTOJS_URL: "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js",
  KINGDEE_PRODUCT_LINE_ID: "1",
};

const HASHIQI_BASE = "https://vip.ioshashiqi.com/aspx3/mobile";
const HASHIQI_SITE = "https://vip.ioshashiqi.com";
const IMYAI_API_BASE = "https://api.daka.today/api";
const KINGDEE_VIP_BASE = "https://vip.kingdee.com";
const IMYAI_DEFAULT_REWARD = "基础+50 / 高级+5 / 绘画+5";

const state = {
  cookieJars: {
    hashiqi: {},
  },
  lines: [],
};

const STEP_TITLES = {
  hashiqi: "🐶 哈士奇签到",
  imyai: "🤖 IMYAI签到",
  kingdee: "🌐 金蝶云社区签到",
  runner: "运行器",
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
  validateConfig();
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
      title: STEP_TITLES[name] || name,
      status: "失败",
      error: describeError(error),
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

    const loginResult = await request({
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
    assertHashiqiLoginSuccess(loginResult);
    const loginCookie = cookieHeader(state.cookieJars.hashiqi);
    if (loginCookie) {
      setPref("QX_SIGNIN_HASHIQI_COOKIE", loginCookie);
    }
  }

  const qiandaoUrl = `${HASHIQI_BASE}/qiandao.aspx`;
  const qiandao = await request({
    url: qiandaoUrl,
    method: "GET",
    jar: state.cookieJars.hashiqi,
    headers: { Referer: loginUrl },
  });
  assertHashiqiAuthenticatedPage(qiandao.body);

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
      reward = extractHashiqiReward(signResult.body) || reward;
    } else {
      throw new Error("哈士奇签到页面解析失败：未找到 VIEWSTATE 字段");
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
  reward = reward || extractHashiqiReward(userCenter.body);
  try {
    const honor = await requestHashiqiHonor(qiandaoUrl);
    reward = extractHashiqiHonorReward(honor) || reward;
  } catch (error) {
    warnLog(`Hashiqi honor query failed: ${describeError(error)}`);
  }
  if (!reward && signed && !signedBefore) {
    const previousTotal = numberFromText(pref("QX_SIGNIN_HASHIQI_LAST_TOTAL"));
    const currentTotal = numberFromText(total);
    if (currentTotal !== null && previousTotal !== null && currentTotal > previousTotal) {
      reward = String(currentTotal - previousTotal);
    }
  }
  if (total) {
    setPref("QX_SIGNIN_HASHIQI_LAST_TOTAL", String(numberFromText(total) || total));
  }
  if (reward && reward !== "未知") {
    setPref("QX_SIGNIN_HASHIQI_LAST_REWARD", reward);
    setPref("QX_SIGNIN_HASHIQI_LAST_REWARD_DATE", todayString());
  } else if (pref("QX_SIGNIN_HASHIQI_LAST_REWARD_DATE") === todayString()) {
    reward = pref("QX_SIGNIN_HASHIQI_LAST_REWARD") || reward;
  }
  reward = reward || "未知";

  return {
    title: "🐶 哈士奇签到",
    status: signed ? "成功" : "未知",
    reward: reward === "未知" ? "未知" : `+${reward}`,
    total: total || "未知",
  };
}

async function signImyai() {
  const jwt = config("IMYAI_JWT");
  if (!jwt) {
    return skipped("🤖 IMYAI签到", "未获取 IMYAI_JWT，请重新登录 IMYAI");
  }
  if (!config("IMYAI_AES_KEY_B64") || !config("IMYAI_HMAC_KEY_B64")) {
    return skipped("🤖 IMYAI签到", "未配置 IMYAI_AES_KEY_B64 / IMYAI_HMAC_KEY_B64");
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
  let todayReward = "";
  try {
    const info = await requestJson({ url: `${IMYAI_API_BASE}/auth/getInfo`, method: "GET", headers });
    before = info && info.data ? info.data : null;
    consecutiveDays = before && before.userInfo ? valueOf(before.userInfo.consecutiveDays, 0) : 0;
  } catch (error) {
    warnLog(`IMYAI getInfo failed: ${error.message || error}`);
  }

  try {
    const log = await requestJson({ url: `${IMYAI_API_BASE}/signin/signinLog`, method: "GET", headers });
    const list = Array.isArray(log.data) ? log.data : [];
    const latest = list.length ? list[list.length - 1] : null;
    signedBefore = !!(latest && isTruthyFlag(latest.isSigned) && latest.signInDate === todayString());
    todayReward = formatImyaiReward(latest) || todayReward;
  } catch (error) {
    warnLog(`IMYAI signinLog failed: ${error.message || error}`);
  }

  let signStatus = signedBefore ? "Already signed" : "Signed";
  const beforeBalance = before && before.userBalance ? before.userBalance : {};
  if (!signedBefore) {
    const body = JSON.stringify(encryptImyaiPayload({}));
    try {
      const signResult = await requestJson({
        url: `${IMYAI_API_BASE}/signin/sign`,
        method: "POST",
        headers,
        body,
      });
      const resultCode = Number(signResult.code);
      const signedByCode = resultCode === 200 || signResult.success === true;
      const alreadySignedByCode = resultCode === 400 && /已签|already|signed/i.test(signResult.message || "");
      todayReward = formatImyaiReward(signResult) || todayReward;
      if (!(signedByCode || alreadySignedByCode)) {
        const msg = signResult.message || JSON.stringify(signResult).slice(0, 180);
        if (/已签|already|signed/i.test(msg)) {
          signStatus = "Already signed";
        } else {
          throw new Error(msg);
        }
      } else if (alreadySignedByCode) {
        signStatus = "Already signed";
      }
    } catch (error) {
      if (/已签|already|signed|400/.test(String(error))) {
        signStatus = "Already signed";
      } else {
        throw error;
      }
    }
  }

  let balance = beforeBalance;
  try {
    const after = await requestJson({ url: `${IMYAI_API_BASE}/auth/getInfo`, method: "GET", headers });
    balance = after && after.data && after.data.userBalance ? after.data.userBalance : balance;
    consecutiveDays = after && after.data && after.data.userInfo ? valueOf(after.data.userInfo.consecutiveDays, consecutiveDays) : consecutiveDays;
  } catch (error) {
    warnLog(`IMYAI getInfo after sign failed: ${error.message || error}`);
  }

  todayReward = todayReward || formatImyaiRewardDiff(beforeBalance, balance);
  if (todayReward) {
    setPref("QX_SIGNIN_IMYAI_LAST_REWARD", todayReward);
    setPref("QX_SIGNIN_IMYAI_LAST_REWARD_DATE", todayString());
  } else if (pref("QX_SIGNIN_IMYAI_LAST_REWARD_DATE") === todayString()) {
    todayReward = pref("QX_SIGNIN_IMYAI_LAST_REWARD") || todayReward;
  }
  if (!todayReward && (signStatus === "Signed" || signStatus === "Already signed")) {
    todayReward = IMYAI_DEFAULT_REWARD;
  }

  return {
    title: `🤖 IMYAI签到（连续${consecutiveDays}天）`,
    status: signStatus === "Signed" || signStatus === "Already signed" ? "已签到" : signStatus,
    todayReward: todayReward || "未知",
    points: `基础${valueOf(balance.model3Count, "未知")} / 高级${valueOf(balance.model4Count, "未知")} / 绘画${valueOf(balance.drawMjCount, "未知")}`,
  };
}

async function signKingdee() {
  const cookie = config("KINGDEE_COOKIE");
  if (!cookie) {
    return skipped("🌐 金蝶云社区签到", "未获取 KINGDEE_COOKIE，请重新登录金蝶云社区");
  }
  const csrf = config("KINGDEE_CSRF_TOKEN") || parseCookieString(cookie)["V-CSRF-TOKEN"] || "";
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
      if (sign.errorCode && sign.errorCode !== 409 && !/signed|已签/i.test(sign.message || "")) {
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

    if (!activity.id) {
      return "activity id missing";
    }
    const activityId = String(activity.id);
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
  return [`## 每日签到报告 ${date}`, ""]
    .concat(lines.map(formatMarkdownReportItem))
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
      item.error ? `错误：${item.error}` : "",
    ].filter(Boolean).join("\n");
  }
  if (item.id === "imyai") {
    return [
      item.title || "🤖 IMYAI签到",
      `状态：${item.status || "未知"}`,
      `今日获得：${item.todayReward || "未知"}`,
      `当前积分：${item.points || "未知"}`,
      item.error ? `错误：${item.error}` : "",
    ].filter(Boolean).join("\n");
  }
  if (item.id === "kingdee") {
    return [
      item.title || "🌐 金蝶云社区签到",
      `状态：${item.status || "未知"}`,
      `今日获得：${item.todayCoins || "未知"} 金币`,
      `抽奖获得：${item.lottery || "未知"}`,
      `当前金币：${item.totalCoins || "未知"}`,
      item.error ? `错误：${item.error}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    item.title || item.id || "任务",
    `状态：${item.status || "未知"}`,
    item.error || item.detail || "",
  ].filter(Boolean).join("\n");
}

function formatMarkdownReportItem(item) {
  const parts = formatReportItem(item).split("\n").filter(Boolean);
  const title = parts.shift() || item.title || item.id || "任务";
  const detail = parts.map((line) => {
    const status = /^状态：(.+)$/.exec(line);
    if (status) {
      return `> 状态：${statusIcon(status[1])} **${status[1]}**`;
    }
    const pair = /^([^：]+)：(.+)$/.exec(line);
    if (pair) {
      return `> ${pair[1]}：**${pair[2]}**`;
    }
    return `> ${line}`;
  });
  return [`### ${title}`].concat(detail).join("\n");
}

function statusIcon(status) {
  if (/成功|已签到|已签/.test(String(status))) {
    return "✅";
  }
  if (/失败|异常|错误|过期|解析失败/.test(String(status))) {
    return "❌";
  }
  return "⚠️";
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
  const url = config("CRYPTOJS_URL");
  const cacheKey = `QX_SIGNIN_CRYPTOJS_CACHE_${simpleHash(url)}`;
  const cached = pref(cacheKey);
  if (cached) {
    try {
      globalEval(cached);
      if (typeof CryptoJS !== "undefined") {
        return;
      }
    } catch (error) {
      warnLog(`CryptoJS cache invalid: ${error.message || error}`);
    }
    setPref(cacheKey, "");
  }
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
  const aesKey = CryptoJS.enc.Base64.parse(config("IMYAI_AES_KEY_B64"));
  const hmacKey = CryptoJS.enc.Base64.parse(config("IMYAI_HMAC_KEY_B64"));
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

async function request(options) {
  const opts = Object.assign({ method: "GET", headers: {} }, options);
  opts.headers = Object.assign({ "User-Agent": userAgent() }, opts.headers || {});
  if (opts.jar) {
    const cookie = cookieHeader(opts.jar);
    if (cookie) {
      opts.headers.Cookie = cookie;
    }
  }
  const shouldStoreCookies = opts.storeCookies !== false;
  const fetchOptions = Object.assign({}, opts);
  delete fetchOptions.jar;
  delete fetchOptions.storeCookies;
  fetchOptions.timeout = requestTimeoutMs();
  const maxAttempts = requestRetries() + 1;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      debugLog(`request attempt ${attempt}/${maxAttempts}: ${fetchOptions.method || "GET"} ${fetchOptions.url}`);
      return await requestOnce(fetchOptions, opts.jar, shouldStoreCookies);
    } catch (error) {
      lastError = error;
      warnLog(`request failed ${attempt}/${maxAttempts}: ${fetchOptions.url} ${describeError(error)}`);
      if (attempt < maxAttempts) {
        await sleep(350 * attempt);
      }
    }
  }
  throw lastError;
}

function requestOnce(fetchOptions, jar, shouldStoreCookies) {
  return new Promise((resolve, reject) => {
    const task = typeof $task !== "undefined" ? $task : null;
    if (!task || typeof task.fetch !== "function") {
      reject(new Error("This script must run in Quantumult X or a compatible $task.fetch environment"));
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error(`Request timeout after ${requestTimeoutMs()}ms: ${fetchOptions.url}`));
    }, requestTimeoutMs());
    task.fetch(fetchOptions).then((response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (jar && shouldStoreCookies) {
        storeCookies(jar, response.headers || {});
      }
      const status = Number(response.statusCode || response.status || 0);
      if (status >= 400) {
        reject(new Error(`HTTP ${status} from ${fetchOptions.url}: ${(response.body || "").slice(0, 240)}`));
        return;
      }
      resolve(response);
    }, (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
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
    IMYAI_AES_KEY_B64: "imyai_aes_key_b64",
    IMYAI_HMAC_KEY_B64: "imyai_hmac_key_b64",
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

function assertHashiqiLoginSuccess(response) {
  const body = String((response && response.body) || "");
  const location = headerValue((response && response.headers) || {}, "location");
  if (/login\.aspx/i.test(location)) {
    throw new Error("哈士奇登录失败：登录后仍跳转到登录页");
  }
  const failure = [
    "密码错误",
    "用户名不存在",
    "账号不存在",
    "登录失败",
    "验证码",
    "请输入验证码",
    "账户被禁用",
    "账号被封",
    "user not found",
    "password",
    "captcha",
  ].find((needle) => body.toLowerCase().includes(needle.toLowerCase()));
  if (failure) {
    throw new Error(`哈士奇登录失败：${failure}`);
  }
  if (/txtUser_sign_in|txtPwd_sign_in|btnLogin/i.test(body) && !/登录成功|success/i.test(body)) {
    throw new Error("哈士奇登录失败：响应仍是登录表单");
  }
}

function assertHashiqiAuthenticatedPage(body) {
  const text = String(body || "");
  if (/txtUser_sign_in|txtPwd_sign_in|btnLogin/i.test(text) && /login|登录/i.test(text)) {
    throw new Error("哈士奇登录失败：未进入签到页，可能需要重新获取 Cookie 或处理验证码");
  }
}

async function requestHashiqiHonor(referer) {
  return requestJson({
    url: `${HASHIQI_SITE}/ashx/Honor.ashx`,
    method: "POST",
    jar: state.cookieJars.hashiqi,
    storeCookies: false,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: HASHIQI_SITE,
      Referer: referer,
    },
    body: formEncode({
      control: "list",
      nowmonth: String(new Date().getMonth() + 1),
    }),
  });
}

function extractHashiqiHonorReward(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const reward = numberFromText(data.addjifen);
  return reward !== null && reward > 0 ? String(reward) : "";
}

function extractHashiqiReward(body) {
  const text = String(body || "");
  return match(text, /today-reward[^>]*>\s*\+?(\d+)\s*狗粮/i) ||
    match(text, /(?:奖励|获得|领取)[^\d+]{0,30}\+?(\d+)\s*(?:狗粮|积分)?/i) ||
    match(text, /\+(\d+)\s*狗粮/i) ||
    match(text, /狗粮[^\d+]{0,30}\+?(\d+)/i);
}

function isTruthyFlag(value) {
  if (value === true) {
    return true;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return /^(1|true|yes|signed|已签|已签到)$/i.test(String(value || "").trim());
}

function formatImyaiReward(result) {
  if (!result) {
    return "";
  }
  const rewardText = firstStringByKeys(result, ["todayReward", "rewardText", "rewardDesc", "reward", "rewards", "message"]);
  if (rewardText && /(\+?\d+|积分|奖励|基础|高级|绘画)/.test(rewardText)) {
    return rewardText;
  }

  const source = result.data && typeof result.data === "object" ? result.data : result;
  const base = firstNumberByKeys(source, ["baseReward", "basicReward", "model3Reward", "model3Add", "model3AddCount", "model3Count", "points", "score"]);
  const advanced = firstNumberByKeys(source, ["advancedReward", "model4Reward", "model4Add", "model4AddCount", "model4Count"]);
  const drawing = firstNumberByKeys(source, ["drawReward", "drawingReward", "drawMjReward", "drawMjAdd", "drawMjAddCount", "drawMjCount"]);
  const parts = [];
  if (base !== null) {
    parts.push(`基础+${base}`);
  }
  if (advanced !== null) {
    parts.push(`高级+${advanced}`);
  }
  if (drawing !== null) {
    parts.push(`绘画+${drawing}`);
  }
  return parts.join(" / ");
}

function formatImyaiRewardDiff(beforeBalance, afterBalance) {
  const diffs = [
    ["基础", numberDiff(beforeBalance && beforeBalance.model3Count, afterBalance && afterBalance.model3Count)],
    ["高级", numberDiff(beforeBalance && beforeBalance.model4Count, afterBalance && afterBalance.model4Count)],
    ["绘画", numberDiff(beforeBalance && beforeBalance.drawMjCount, afterBalance && afterBalance.drawMjCount)],
  ];
  const parts = diffs
    .filter((item) => item[1] !== null && item[1] > 0)
    .map((item) => `${item[0]}+${item[1]}`);
  return parts.join(" / ");
}

function numberDiff(before, after) {
  const beforeNumber = numberFromText(before);
  const afterNumber = numberFromText(after);
  if (beforeNumber === null || afterNumber === null || afterNumber < beforeNumber) {
    return null;
  }
  return afterNumber - beforeNumber;
}

function firstStringByKeys(obj, keys) {
  const found = findByKeys(obj, keys);
  if (found === undefined || found === null || typeof found === "object") {
    return "";
  }
  return String(found);
}

function firstNumberByKeys(obj, keys) {
  const found = findByKeys(obj, keys);
  if (found === undefined || found === null || found === "") {
    return null;
  }
  const value = Number(found);
  return Number.isFinite(value) ? value : null;
}

function findByKeys(obj, keys) {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }
  }
  const nested = obj.data && typeof obj.data === "object" ? findByKeys(obj.data, keys) : undefined;
  if (nested !== undefined) {
    return nested;
  }
  return undefined;
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

function numberFromText(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const found = String(value).replace(/,/g, "").match(/\d+/);
  const number = Number(found ? found[0] : "");
  return Number.isFinite(number) ? number : null;
}

function describeError(error) {
  if (!error) {
    return "未知错误";
  }
  if (error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch (jsonError) {
    return String(error);
  }
}

function simpleHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function validateConfig() {
  const webhook = config("WECOM_WEBHOOK_URL");
  if (webhook && !/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/.test(webhook)) {
    throw new Error("WECOM_WEBHOOK_URL 格式不正确");
  }
  const cryptoJsUrl = config("CRYPTOJS_URL");
  if (cryptoJsUrl && !/^https?:\/\//.test(cryptoJsUrl)) {
    throw new Error("CRYPTOJS_URL 必须是 http/https URL");
  }
}

function requestTimeoutMs() {
  const value = Number(config("REQUEST_TIMEOUT_MS") || 10000);
  return Number.isFinite(value) && value > 0 ? value : 10000;
}

function requestRetries() {
  const value = Number(config("REQUEST_RETRIES") || 2);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 5) : 2;
}

function debugEnabled() {
  return /^(1|true|yes|on)$/i.test(String(config("DEBUG") || ""));
}

function debugLog(message) {
  if (debugEnabled() && typeof console !== "undefined" && console.log) {
    console.log(`[DEBUG] ${message}`);
  }
}

function warnLog(message) {
  if (debugEnabled() && typeof console !== "undefined" && console.log) {
    console.log(`[WARN] ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
