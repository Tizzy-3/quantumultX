# Quantumult X 签到脚本

这个目录是原 Python 签到项目的 Quantumult X 版本，支持三个任务：

- 哈士奇签到
- IMYAI 签到
- 金蝶云社区签到 + 抽奖

脚本还支持企业微信机器人推送。现在已经加入“登录网站自动捕获 cookie/token”的模式：你只要在手机上通过 Quantumult X 代理登录对应网站，捕获脚本会合并请求 Cookie 和响应 `Set-Cookie`，再把凭证保存到 Quantumult X 的 `$prefs`，定时签到脚本会自动读取。

## 文件说明

- `qx_signin.js`：定时签到主脚本。
- `qx_cookie_capture.js`：登录网站时自动捕获 cookie/token 的 rewrite 脚本。
- `qx_rewrite.conf`：rewrite 规则远程订阅文件（推荐用 rewrite_remote 一行订阅）。
- `boxjs.json`：BoxJS 可视化配置面板。
- `quantumultx.conf.example`：Quantumult X 配置示例。

## 使用步骤（GitHub 远程脚本）

1. 把 `qx_signin.js` 和 `qx_cookie_capture.js` 上传到 GitHub 仓库：
   `https://github.com/Tizzy-3/quantumultX`
   如果使用 BoxJS，也上传 `boxjs.json`、订阅头像 `patrick.png` 和应用图标 `To-do.png`。
2. 确认这两个远程链接能打开：
   - `https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_signin.js`
   - `https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_cookie_capture.js`
   - `https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/boxjs.json`
   - `https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/patrick.png`
   - `https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/To-do.png`
3. 把 `quantumultx.conf.example` 里的 `[rewrite_remote]`、`[task_remote]`、`[mitm]` 配置合并到你的 Quantumult X 配置。rewrite 规则推荐用远程订阅一行搞定，贴上去就行。
4. 在 Quantumult X 中安装并信任 MITM 证书。
5. 打开 Quantumult X 代理。
6. 分别登录这些网站：
   - `https://vip.ioshashiqi.com`
   - `https://super.imyaigc.com`
   - `https://vip.kingdee.com`
7. 看到类似“哈士奇 / 获取cookies成功”“IMYAI / 获取token成功”“金蝶云社区 / 获取cookies成功”的通知后，就可以运行定时任务。

## 自动保存的配置

捕获脚本会写入这些 `$prefs` key：

- `QX_SIGNIN_HASHIQI_COOKIE`
- `QX_SIGNIN_IMYAI_JWT`
- `QX_SIGNIN_KINGDEE_COOKIE`
- `QX_SIGNIN_KINGDEE_CSRF_TOKEN`
- `QX_SIGNIN_KINGDEE_PRODUCT_LINE_ID`

主脚本会优先读取 `$prefs`。如果 `$prefs` 没有值，才会读取 `qx_signin.js` 顶部的 `USER_CONFIG`。

## BoxJS 配置

推荐用 BoxJS 管理这些配置：

```text
https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/boxjs.json
```

在 BoxJS 中添加订阅后，应显示订阅名：

```text
Tizzy3 脚本订阅
```

订阅下会出现应用：

```text
Daily Sign-in
```

订阅头像来自仓库根目录的：

```text
https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/patrick.png
```

应用图标来自仓库根目录的：

```text
https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/To-do.png
```

打开“Daily Sign-in”面板，可以配置：

- 企业微信 Webhook
- IMYAI AES Key
- IMYAI HMAC Key
- 调试日志开关
- 请求超时和重试次数
- 自动捕获到的哈士奇 / IMYAI / 金蝶凭证

自动捕获脚本写入的也是同一组 `QX_SIGNIN_...` key，所以 BoxJS 里能直接看到和修改。

## 仍需手动配置的项目

企业微信 webhook 不会自动捕获，需要你手动填到 `qx_signin.js`：

```js
const USER_CONFIG = {
  WECOM_WEBHOOK_URL: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的key",
};
```

如果你不需要企业微信推送，保持空字符串即可，脚本仍会发 Quantumult X 通知。

IMYAI 加密密钥不再硬编码在源码里。需要你在 `qx_signin.js` 顶部填入：

```js
const USER_CONFIG = {
  IMYAI_AES_KEY_B64: "你的 AES key",
  IMYAI_HMAC_KEY_B64: "你的 HMAC key",
};
```

可选调试配置：

```js
const USER_CONFIG = {
  DEBUG: "true",
  REQUEST_TIMEOUT_MS: "10000",
  REQUEST_RETRIES: "2",
};
```

## 定时任务示例

```ini
[task_remote]
0 8 * * * https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_signin.js, tag=Daily Sign-in, img-url=checkmark.seal.system, enabled=true
```

## Rewrite 和 MITM 示例

推荐用 `[rewrite_remote]`，一行订阅，后续更新自动同步：

```ini
[rewrite_remote]
https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_rewrite.conf, tag=每日签到Cookie捕获, enabled=true
```

如果 rewrite_remote 不可用，也可以手动逐条加到 `[rewrite_local]`：

```ini
[rewrite_local]
^https:\/\/vip\.ioshashiqi\.com\/ url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_cookie_capture.js
^https:\/\/super\.imyaigc\.com\/ url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_cookie_capture.js
^https:\/\/api\.daka\.today\/ url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_cookie_capture.js
^https:\/\/api\.imyaigc\.com\/ url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_cookie_capture.js
^https:\/\/vip\.kingdee\.com\/ url script-response-header https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_cookie_capture.js

[mitm]
hostname = vip.ioshashiqi.com, super.imyaigc.com, api.daka.today, api.imyaigc.com, vip.kingdee.com
```

## 过期后怎么处理

如果签到脚本提示 cookie 过期、未授权、401，重新打开 Quantumult X 代理并登录对应网站即可。捕获脚本会刷新 `$prefs`，不需要手动复制 cookie。

## 故障排查

- `状态：未配置`：没有捕获到对应 cookie/token，重新登录对应网站。
- `401`：cookie/token 过期，重新登录。
- `哈士奇签到页面解析失败`：页面结构变化或 cookie 无效，需要重新登录后再试。
- `IMYAI 未配置密钥`：补齐 `IMYAI_AES_KEY_B64` 和 `IMYAI_HMAC_KEY_B64`。
- 没有通知：确认定时任务使用的是远程 raw 链接，并查看 Quantumult X 脚本日志。

## 注意事项

- IMYAI 签到需要加密请求体，`qx_signin.js` 第一次运行会加载 CryptoJS 并缓存到 `$prefs`。
- 金蝶云社区使用 cookie 模式，避免在 QX 里复刻复杂 SSO 登录流程。
- 哈士奇优先使用捕获到的 cookie；没有 cookie 时也可以用 `HASHIQI_USERNAME` 和 `HASHIQI_PASSWORD` 账号密码登录。
