# Quantumult X 每日签到

支持以下任务：

- 哈士奇签到
- IMYAI 签到
- 金蝶云社区签到与抽奖
- Quantumult X 本地通知
- 企业微信机器人推送（可选）
- BoxJS 配置面板

脚本支持自动捕获 cookie/token。开启 Quantumult X 代理后，登录对应网站，`qx_cookie_capture.js` 会保存签到所需凭证。

## 文件说明

```text
qx_signin.js              定时签到脚本
qx_cookie_capture.js      登录时自动捕获 cookie/token
qx_rewrite.conf           rewrite 远程订阅
boxjs.json                BoxJS 配置面板
quantumultx.conf.example  Quantumult X 配置示例
```

## Quantumult X 配置

推荐使用 rewrite 远程订阅：

```ini
[rewrite_remote]
https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_rewrite.conf, tag=每日签到Cookie捕获, enabled=true

[task_remote]
0 8 * * * https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/qx_signin.js, tag=Daily Sign-in, img-url=checkmark.seal.system, enabled=true

[mitm]
hostname = vip.ioshashiqi.com, super.imyaigc.com, api.daka.today, api.imyaigc.com, vip.kingdee.com
```

在 Quantumult X 中完成以下操作：

1. 安装并信任 MITM 证书。
2. 开启 Quantumult X 代理。
3. 刷新 rewrite 远程订阅。
4. 分别登录以下网站。

```text
https://vip.ioshashiqi.com
https://super.imyaigc.com
https://vip.kingdee.com
```

获取成功后会收到通知：

```text
哈士奇 / 获取cookies成功
IMYAI / 获取token成功
金蝶云社区 / 获取cookies成功
```

IMYAI 使用的是 `QX_SIGNIN_IMYAI_JWT`，不是普通 cookie。登录后建议进入首页或签到页，以触发 API 请求。

## BoxJS

订阅地址：

```text
https://raw.githubusercontent.com/Tizzy-3/quantumultX/refs/heads/main/boxjs.json
```

## 企业微信推送

如不需要企业微信推送，可跳过本节。

如需启用，在 BoxJS 中填写：

```text
QX_SIGNIN_WECOM_WEBHOOK_URL
```

格式示例：

```text
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
```
