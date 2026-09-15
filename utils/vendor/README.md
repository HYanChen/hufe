# 本地二维码依赖

- `qrcode.mjs`：Kazuhiko Arase qrcode-generator，MIT；来源 https://github.com/kazuhikoarase/qrcode-generator/blob/master/js/dist/qrcode.mjs
- `jsqr.mjs`：Cosmo Wolfe jsQR 1.4.0，Apache-2.0；来源 https://github.com/cozmo/jsQR/blob/master/dist/jsQR.js 。仅增加隔离 UMD 的 ESM 导出包装。
- 下载日期：2026-09-12。许可原文随同保留。两者随 H5 发布包本地打包，不调用外部二维码服务，不将身份信息或核验码发送第三方。

随包文件 SHA-256（含本地 ESM 包装）：

- qrcode.mjs: `476bd2bc714bd9504acb6b6e1eb916dde64ced8de2fdeeb011f7344869a3be3f`
- jsqr.mjs: `8e582f89aef0ac0d306d4d75bf5b16277f83c1b7e98c6dbb0e89dec2df15b9aa`
