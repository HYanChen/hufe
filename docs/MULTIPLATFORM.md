# uni-app 多端开发、构建与发布

本项目的用户端采用 **Vue 3 + uni-app + Vite**；`admin/` 是独立的 Vue 管理后台，`server/` 是独立的 Node.js API。生成用户端小程序或 App 不会自动部署后台、MySQL 或地图服务。

**当前以 H5 为主要交付端。仓库提供微信小程序、支付宝小程序和 App 的构建入口，但不代表这些端已完成真机验收或应用商店审核。** 现存差异见文末；学校实名注册、大文件和地图尤其不能只改 AppID 后直接上线。

## 1. 开发环境与项目结构

- 构建工具链的 pnpm 11.19.0 要求 Node.js **22.13 或更高的兼容版本**；本次实际验证 Node.js 24.19.0 / pnpm 11.19.0。根项目声明 Node.js ≥ 18、API 声明 ≥ 20 是各包下限，不代表所有这些版本满足当前 pnpm 要求或均已验收。
- 使用上述已验证的 pnpm 版本和仓库的 `pnpm-lock.yaml`，避免将 uni-app 编译器依赖分别升级成不同版本。生产 Node.js 运行时按部署指南单独确认。
- 当前 `@dcloudio/*` 编译依赖统一锁定为 `3.0.0-5010520260709002`。HBuilderX、调试基座与编译器需使用兼容版本。
- 根目录就是用户端源码目录，包含 `App.vue`、`main.js`、`pages.json`、`manifest.json`，**不是 `src/` 目录**。`scripts/run-uni.mjs` 设置 `UNI_INPUT_DIR` 为当前工作目录，所以以下命令必须在仓库根目录执行。
- `server/` 内有前端引用的品牌定义等共享文件，不要仅复制 `pages/` 就尝试构建。

```bash
git clone https://github.com/HYanChen/hufe.git
cd hufe
pnpm install --frozen-lockfile
```

首次安装需要能访问包仓库。源码仓库和网页发布包不是包含 Node.js、MySQL、HBuilderX、微信/支付宝开发者工具的离线安装器。

## 2. 先配置 API，不要将密钥放进客户端

### 本地 H5

将根目录 `.env.example` 复制为本机 `.env.local` 并按实际地址调整：

```dotenv
VITE_API_BASE_URL=http://localhost:8787
VITE_API_TIMEOUT=10000
VITE_IDENTITY_FRESH_TTL_MS=300000
VITE_SCHOOL_REGISTRATION_READY=false
```

API 的数据库、哈希密钥、认证协议等配置单独放在服务端环境文件，按[生产部署说明](../deploy/handoff/正式环境部署说明.md)和根 README 准备。只有前端页面启动，不代表 API 或数据库已经就绪。

### 正式 H5

前台与 API 同源部署时，构建环境使用：

```dotenv
VITE_API_BASE_URL=
VITE_API_TIMEOUT=10000
VITE_IDENTITY_FRESH_TTL_MS=300000
VITE_SCHOOL_REGISTRATION_READY=false
```

可保存为本机 `.env.production.local`。同源模式下 `/api/`、`/health` 需代理到真实 API，不能被 SPA 首页回退规则接管。地图路径同样在 `/api/v1/maps/` 下。

### 微信、支付宝和 App

这些端没有网页的同源地址，**必须在构建时给出完整的正式 HTTPS API 源地址**，例如 `https://your-school.example`。这里填的是源地址，不要再加 `/api/v1`：服务方法已携带该前缀，否则会拼成重复路径。

`services/http.js` 会拒绝非 H5 端的空地址或 HTTP 地址，返回 `API_BASE_URL_REQUIRED`。本机 `localhost` 指的是手机/开发工具自己的运行环境，不是开发电脑。开发工具能连通，不等于真机能连通。

`VITE_*` 值会进入客户端构建产物，属于公开配置。**不得填写数据库密码、JWT/签名密钥、学校认证客户端密钥或管理员密码。** 改环境变量后必须重新构建，并核对最终请求地址；只重启 Nginx 不会改已生成的 JavaScript。

学校实名入口主要由后台配置和服务端校验控制。旧 `VITE_SCHOOL_REGISTRATION_READY` 不是启用学校接口的充分条件；当前 `sso-webview` 页面还使用该值作保护检查，也不能靠设为 `true` 绕过服务端安全回跳限制。

## 3. 已有命令与产物路径

下表按当前 Vue 3 CLI 包装脚本和默认输出目录整理；如显式设置 `UNI_OUTPUT_DIR`，以控制台显示的实际输出目录为准。

| 目标 | 开发命令 | 生产构建 | 默认构建结果 |
| --- | --- | --- | --- |
| 用户端 H5 | `pnpm dev:h5` | `pnpm build:h5` | `dist/build/h5/` |
| 微信小程序 | `pnpm dev:mp-weixin` | `pnpm build:mp-weixin` | `dist/build/mp-weixin/` |
| 支付宝小程序 | `pnpm dev:mp-alipay` | `pnpm build:mp-alipay` | `dist/build/mp-alipay/` |
| Android / iOS 公用 App 资源 | `pnpm dev:app` | `pnpm build:app` | `dist/build/app/`；不是 APK/IPA |
| 独立 Web 管理后台 | `pnpm admin:dev` | `pnpm admin:build` | `admin/dist/` |

小程序开发监听产物在对应 `dist/dev/<平台>/`；H5 开发由 Vite 提供服务，不是可部署的目录。App 的开发命令只参与资源编译/监听，安装基座及真机运行仍需 HBuilderX。

`pnpm build` / `pnpm build:sites` 额外执行 `prepare-sites-build.mjs`，属于网页发布适配入口。一般服务器上的 H5 构建使用 `build:h5`；它们都不是“一键生成全部平台”。

uni-app 官方区分 CLI 工程的 `dist/` 与 HBuilderX 可视化工程的 `unpackage/`；不要把别的教程中的 `unpackage/dist/build/` 路径机械套用到本仓库。参见 [CLI 运行与发布](https://uniapp.dcloud.net.cn/quickstart-cli.html)。

## 4. H5：网页、手机浏览器和电脑浏览器

### 开发

先按根 README 启动并确认 API 可用，再运行：

```bash
pnpm dev:h5
```

需要明确监听地址或端口时，可直接使用包装脚本：

```bash
node scripts/run-uni.mjs dev h5 --host 127.0.0.1 --port 5173 --strictPort
```

`vite.config.js` 将 `/api` 与 `/health` 代理到本地 API，目标可由 `HUFE_API_PROXY` 指定。这个代理解决开发访问，不会出现在生产静态站点中。

### 构建和部署

```bash
pnpm build:h5
pnpm admin:build
```

将 `dist/build/h5/` 的内容部署为前台站点，将 `admin/dist/` 的内容部署到配置对应的管理后台路径；不要暴露整个源码目录。使用[交付目录中的 Nginx 示例](../deploy/handoff/nginx-site.conf.example)核对静态路径和 API 转发。

当前 `manifest.json` 的 H5 路由为 hash，根路径为 `/`。部署到子目录时须一起调整应用路径、API 代理、资源 URL 和回调白名单，不能只把文件放入子目录。

正式环境使用 HTTPS。扫码相机使用浏览器安全上下文与相机权限；聊天分片校验使用 `crypto.subtle`。本地浏览器对 `localhost` 的特殊待遇不能作为 HTTP 正式域名的验收结果。学校实名注册还需要同一浏览器中的 HttpOnly Cookie 与已登记回调地址；优先同源部署。

## 5. 微信小程序

### 发布前配置

1. 由运营主体准备自己的微信小程序，取得真实 AppID，并确认开发者有项目权限。
2. 在根 `manifest.json` 的 `mp-weixin.appid` 填写微信 AppID；当前仓库该字段为空。不要把顶层 DCloud AppID 填到这里。
3. 在微信平台配置实际 API 的服务器域名、所用上传/下载域名；如后续接入 `web-view`，还要单独配置业务域名。开发工具里的关闭域名校验只是调试选项，不是生产方案。
4. 配置 HTTPS 网关、隐私声明及实际调用功能涉及的权限；不要默认开启项目未使用的能力。

各小程序 `web-view` 的域名与容器行为存在限制，详见 [uni-app web-view 文档](https://uniapp.dcloud.net.cn/component/web-view)。

### 编译和导入

在 macOS / Linux 终端可对单次构建注入实际源地址：

```bash
VITE_API_BASE_URL=https://your-school.example pnpm dev:mp-weixin
```

在微信开发者工具导入 **`dist/dev/mp-weixin/`**，使用同一个微信 AppID，预览并真机调试。正式候选版本重新运行：

```bash
VITE_API_BASE_URL=https://your-school.example pnpm build:mp-weixin
```

导入或切换到 **`dist/build/mp-weixin/`**，检查编译日志、包体积和真机网络，再按平台流程上传体验版、验收、提交审核、发布。不要上传仓库根目录、H5 目录或开发监听产物。微信/支付宝代码导入与审核流程可参考 [uni-app 小程序发行说明](https://uniapp.dcloud.net.cn/quickstart-hx#发布为小程序)。

Windows PowerShell 可先用 `$env:VITE_API_BASE_URL="https://your-school.example"` 设置本次终端环境，再执行相同 pnpm 命令；完成后清除该变量或关闭终端，避免后续 H5 构建误用。

## 6. 支付宝小程序

1. 由运营主体在支付宝开放平台创建小程序，并给开发者授权。
2. 将生成项目关联到真实支付宝应用，检查 `manifest.json` 的 `mp-alipay` 配置和开发工具项目设置。当前仓库只有 `usingComponents`，没有已绑定的支付宝应用身份。
3. 设置实际 HTTPS API/资源服务器域名及平台要求的权限说明。微信 AppID、DCloud AppID 与支付宝应用 ID 不能混用。
4. 运行以下命令，将 **`dist/dev/mp-alipay/`** 导入支付宝小程序开发者工具进行真机联调：

```bash
VITE_API_BASE_URL=https://your-school.example pnpm dev:mp-alipay
```

5. 正式候选版执行：

```bash
VITE_API_BASE_URL=https://your-school.example pnpm build:mp-alipay
```

6. 将 **`dist/build/mp-alipay/`** 作为待上传项目，验收后在支付宝开放平台提交审核并发布。不要直接复用微信生成目录。

支付宝与微信的文件系统、扫码、样式和权限行为不能互相代替验收。尤其是当前图片分片依赖 `uni.getFileSystemManager().readFile` 的二进制和分段读取能力，应以真实支付宝运行环境测试为准。

## 7. Android / iOS App

### 7.1 编译资源不等于安装包

```bash
VITE_API_BASE_URL=https://your-school.example pnpm build:app
```

该脚本调用 `uni build -p app`，输出 App 前端资源，**不直接生成签名 APK、AAB 或 IPA**。本仓库是 Vue 3，使用 `app` 参数；一些旧 Vue 2 文档使用 `app-plus`，不要据此自行修改现有脚本。[uni-app CLI 官方说明](https://uniapp.dcloud.net.cn/worktile/CLI.html)明确区分资源编译与 HBuilderX 云打包。

### 7.2 HBuilderX 配置与真机运行

1. 安装包含 App 开发插件的 HBuilderX，将仓库作为现有工程打开；保留项目自己的依赖锁文件。若 IDE 以默认 `src/` 结构识别失败，以本项目 CLI 包装脚本为准配置源码根目录，不要直接搬动源码。
2. 在 DCloud 开发者中心创建/关联属于发布主体的应用，并在 HBuilderX 中绑定其正式 DCloud AppID。仓库顶层 `__UNI__HUFEALUMNI` 不是已验证可用于云打包的凭据。
3. 在 `manifest.json` 补齐应用名称、版本、图标、启动页、Android 包名、iOS Bundle ID、需要的模块和权限说明。当前 Android 权限列表为空，iOS 发布证书及签名信息也没有包含在仓库里。
4. 用 HBuilderX 的运行到手机/自定义调试基座流程连接 Android 与 iPhone，检查 WebView、登录、扫码、文件和前后台切换。`pnpm dev:app` 本身不会安装 App，也不会启动 Android/iOS 模拟器。

### 7.3 生成可安装版本

- **Android**：在 HBuilderX 的 App 发行/云打包流程选择 Android，配置包名和由发布主体保管的签名证书，生成并验收安装包；若使用离线打包，则另行准备匹配的原生 SDK 和 Android 构建工程。
- **iOS**：准备 Apple 开发者身份、Bundle ID、证书和匹配的描述文件，通过 HBuilderX 云打包或匹配的 iOS 原生工程生成签名包，再按选定分发方式测试。资源目录或 `.wgt` 不能当作 IPA 安装。
- 签名证书、私钥、密码、描述文件不得提交到公开仓库。版本升级应保留正式签名身份，避免覆盖安装失败。
- App 的商店元数据、隐私声明、权限用途、支持信息及审核资料需由发布主体确认；这些不是编译命令自动生成的结果。

## 8. 当前已知跨端差异与发布阻碍

以下结论来自本仓库代码检查，不能由“编译成功”消除：

| 功能 | 当前实现 | 非 H5 发布要求 |
| --- | --- | --- |
| 平台账号登录 | `services/schoolAuth.js` 调用平台 API，携带设备标识；不是微信/支付宝一键登录 | 真机验证 HTTPS、持久存储、同设备保活、换设备失效、改密后重新登录；不能假设各端共享同一份本地存储 |
| 学校统一认证注册 | `server/src/app.js` 对非 H5 注册事务直接返回 `REGISTRATION_PLATFORM_BINDING_UNAVAILABLE`；客户端恢复流程同样拒绝 | **目前请在正式 H5 的同一浏览器完成注册**。需要另行实现和验收安全回跳/设备绑定；不能只打开旧构建开关或删除保护判断 |
| 个人资料、普通业务请求 | 通用 `uni.request` + Bearer 身份校验 | 每个目标平台联调权限、空态、异常和表单；后端权限不能由前端展示替代 |
| 5 GB 聊天文件/聊天图片选择 | `services/chat.js` 使用浏览器 File、fetch、Web Crypto；非 H5 明确拒绝选择文件并提示使用浏览器 | **当前不是原生 App/小程序大文件功能**，需专门文件选择、分片读取、断点续传和后台下载适配 |
| 聊天附件下载 | H5 打开带短期票据的下载链接；非 H5 仅显示浏览器下载提示 | 补齐平台下载/保存/预览及票据过期处理；勿将带票据的链接公开 |
| 500 MB 图片上传 | H5 使用 Blob 分片；非 H5 大图片依赖文件系统分段读取，小图片存在平台读取分支 | 单张上限是业务限制，不是每个端的能力保证。App/支付宝的 API 可用性、内存、磁盘及断网恢复必须真机验证 |
| 长沙街道地图 | `pages/alumni-map/index.vue` 的 iframe 仅编入 H5；服务端提供底图、字体和查看器 | 非 H5 只有引导入口，`utils/cityMap.js` 目前仍返回相对 `/api/...` 路径，**需要补齐 HTTPS 外链或合规 web-view 实现后才能视为可用** |
| 电脑右下角对话窗口 | 仅 H5 挂载到 DOM，并按宽屏条件显示 | 移动端用对话页面；不要把桌面浮层当作小程序功能 |
| 返校扫码 | H5 使用浏览器相机/二维码图片解析；非 H5 有 `uni.scanCode` 分支 | 相机拒绝、取消、二维码过期/重复、角色授权、确认后记录，均需在每个真机平台验证 |
| 外部链接 | H5 新窗口，App 外部浏览器，小程序复制 HTTPS 链接 | 外链不是原生业务页；地图当前相对 URL 的问题不能用此能力掩盖 |
| 页面排版 | 通用 Vue 页面包含条件编译、rpx、弹层和部分 H5 DOM 能力 | 小程序组件层级、长文本、键盘遮挡、安全区、滚动/返回均需复核；没有“多端像素级一致”承诺 |

地图为**服务器本地托管**，不是已把全国离线地图打进手机安装包；当前内置长沙及周边数据，其他地区需要后台导入合规资源。地图展示城市级聚合数量，不提供个人实时坐标。

当前仓库只声明 H5、微信、支付宝与 App 编译依赖。其他小程序、鸿蒙、快应用等需要增加对应平台依赖和适配，不应把官方支持的平台列表当作本项目已支持列表。

## 9. 发布前验收清单

### 代码与构建检查

```bash
pnpm validate
pnpm client:test
pnpm admin:test
pnpm server:test
pnpm build:h5
pnpm admin:build
```

再分别执行目标端的 `build:*`。测试结果应记录提交号、Node/pnpm/编译器版本、API 版本和测试时间；部分集成测试需要对应环境，必须区分通过、跳过和未执行。本说明本身不是多端测试报告。

### 每个目标端必须单独验证

- [ ] 构建退出码成功；目标目录、AppID、网关和资源路径正确；没有本机地址或真实密钥进入产物。
- [ ] 未登录、普通用户、已实名用户、受限账号的访问行为正确；首登改密、忘记/重置后的重新登录经过验证。
- [ ] 单设备会话策略、手工退出、账号切换和多标签/多端失效符合当前服务端规则。
- [ ] 对话、发帖、评论、敏感词、模块关闭和后台下架等功能使用真实 API，不是静态演示。
- [ ] 图片/附件正常、取消、超限、弱网、断网、重新选择文件和存储不足均有明确结果；未完成的非 H5 能力不对用户宣传为可用。
- [ ] 学校实名注册按本节限制处理；没有将测试/本地回调发给学校生产认证系统。
- [ ] 地图、证书、学校品牌图片和私有材料加载正确；受保护下载不会泄露给其他用户。
- [ ] 首页、资料、列表、详情、长表单、弹窗、扫码、键盘遮挡、返回和安全区已在真实屏幕检查。
- [ ] 正式 HTTPS 证书、API 域名白名单、后端持久卷、MySQL 备份、日志及发布回滚方案就绪。
- [ ] 微信/支付宝体验版、Android 实机、iPhone 实机分别留下验收结果；未验收项不能用 H5 测试结果代替。

## 10. 常见问题

**找不到 `node_modules/.bin/uni`**：确认在仓库根目录并完成 workspace 依赖安装；不要在 `pages/` 或 `admin/` 目录运行用户端脚本。

**小程序提示 API 网关未配置**：检查本次构建真正使用的 `VITE_API_BASE_URL` 是否为 HTTPS 源地址；重新构建而不是只重新打开开发工具。

**开发工具正常，手机请求失败**：核对真机能访问的网关、证书链和域名配置；手机上的 `localhost` 不是电脑。不要通过永久关闭校验解决生产连通性。

**地图中出现首页**：检查 `/api/v1/maps/viewer/index.html` 是否被静态站点 SPA 回退接管；地图资源必须转发到 API。非 H5 另有相对 URL 和容器适配问题，见差异表。

**构建 App 后没有 APK/IPA**：这是预期，`build:app` 是资源编译步骤，后续仍需 HBuilderX/原生 SDK 和签名打包。

**App/小程序学校认证不能继续**：当前服务端主动禁止未完成安全绑定的非 H5 注册，不是填入账号密码就能修复。使用正式 H5 完成注册，或先开发并审查对应端的安全回跳流程。

**后端提示 `MYSQL_NOT_MIGRATED`**：这是数据库初始化/迁移边界，与 uni-app 构建无关。不要为方便预览在正式环境创建测试管理员、拷入测试快照或重复执行旧 JSON 迁移脚本；按照部署说明处理。

## 11. 参考依据

本说明核对时间：2026-09-16。项目命令、配置和能力边界以当前代码为准；第三方开发工具菜单和平台审核要求以发布时官方说明为准。

- 项目构建入口：[package.json](../package.json)、[run-uni.mjs](../scripts/run-uni.mjs)、[manifest.json](../manifest.json)。
- 项目网络与注册：[services/http.js](../services/http.js)、[services/schoolAuth.js](../services/schoolAuth.js)、[server/src/app.js](../server/src/app.js)。
- 项目文件和地图：[services/chat.js](../services/chat.js)、[services/privateMaterials.js](../services/privateMaterials.js)、[services/imageUploads.js](../services/imageUploads.js)、[utils/cityMap.js](../utils/cityMap.js)。
- [DCloud：CLI 工程与输出目录](https://uniapp.dcloud.net.cn/quickstart-cli.html)。
- [DCloud：uni CLI 与 HBuilderX CLI、App 资源和安装包区别](https://uniapp.dcloud.net.cn/worktile/CLI.html)。
- [DCloud：HBuilderX 运行及各端发行](https://uniapp.dcloud.net.cn/quickstart-hx)。
- [DCloud：web-view 平台差异](https://uniapp.dcloud.net.cn/component/web-view)。
- [DCloud：manifest.json 与各类 AppID](https://zh.uniapp.dcloud.io/collocation/manifest.html)。
- [DCloud：跨端注意事项](https://uniapp.dcloud.net.cn/matter)。
