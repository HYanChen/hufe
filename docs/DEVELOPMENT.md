# 本地开发、构建与测试

本文用于从干净 Git 克隆建立隔离开发环境。正式部署请阅读 [部署说明](DEPLOYMENT.md)；多端产物、开发者工具及端能力限制见 [uni-app 多端指南](MULTIPLATFORM.md)。

> 本地开发演示数据、开发管理员和 JSON 存储不应直接变成正式学校人员数据。不要将生产数据库、上传材料、密钥或真实人员信息复制进公开仓库。

## 1. 工具链

- Git。
- Node.js：生产服务推荐 Node.js 22；依赖安装工具链的 pnpm 11.19.0 则明确要求 **Node.js 22.13 或更高的兼容版本**，不是任意 Node.js 22 均满足要求。本次已在独立干净快照验证 Node.js 24.19.0 / pnpm 11.19.0 的冻结锁文件安装成功，其他版本组合和部署运行环境仍需单独验收。
- pnpm：本仓库是三包 workspace，保留 `pnpm-lock.yaml`，不要在各目录混用 npm/yarn 安装后覆盖锁文件。
- 目标端开发者工具、签名和平台账号按需准备；只运行 H5 不需要小程序开发者工具。

根包声明 `node >=18`、服务端声明 `node >=20` 是各包的引擎下限，不代表所有这些旧 Node 版本都经过当前锁文件的完整验收。安装工具链和生产运行时可以分别选择；不要把 macOS/Windows 的 `node_modules` 直接复制到 Linux 生产机器。

```sh
git clone https://github.com/HYanChen/hufe.git
cd hufe
node --version
pnpm --version
pnpm install --frozen-lockfile
```

如尚未安装 pnpm，可在支持的 Node 环境安装指定版本：

```sh
npm install --global pnpm@11.19.0
```

若提示 Node 引擎不兼容，先切换到支持该 pnpm 的构建用 Node 版本，不要直接忽略引擎检查。若锁文件不匹配，确认分支及 pnpm 版本后排查；不要把移除 `--frozen-lockfile` 当作常规修复。工作区已为必要依赖列出构建脚本许可，新增许可应逐项审查，不要无条件允许所有依赖脚本。

## 2. 配置三个独立进程

在仓库根目录复制模板：

```sh
cp .env.example .env
cp server/.env.example server/.env
```

使用编辑器检查配置，不要把示例认证地址当成可用服务：

1. 根 `.env` 是 uni-app 构建/开发配置，开发 API 源站通常是 `http://localhost:8787`。
2. `server/.env` 是 API 私有配置。首次本地开发设置 `NODE_ENV=development`、`DATABASE_DRIVER=json`；不连接正式 MySQL。
3. 为本开发环境生成独立的 `DATA_HASH_SECRET`，替换模板占位值。可使用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成，再通过编辑器保存。
4. 不使用手动同步密钥时，把 `ADMIN_SYNC_KEY` 留空，或另生成独立值；不要保留公开模板中的占位值。
5. 保持 `SSO_MANAGED_IN_ADMIN=true`，学校认证默认不启用。localhost 不是学校已登记的 HTTPS 回调域名；本地演示不应尝试真实学校身份登录。

默认数据位置为 `server/data/`。相对 `DATA_FILE`、`MEDIA_DIR` 和 `CONTENT_CACHE_FILE` 以服务端根目录为基准。更改 `DATA_HASH_SECRET` 会影响已有身份散列及加密内容，不能每次启动随机重置；若只是全新隔离测试，创建新的数据目录和配套密钥，而不是复用有数据的目录。

API 入口通过 `dotenv/config` 读取当前工作目录的 `.env`。通过下面的 workspace 命令启动时，API 工作目录是 `server/`。不要直接在仓库根目录执行 `node server/src/index.js` 后期待它自动加载 `server/.env`；若这样运行，需显式使用 `node --env-file=server/.env server/src/index.js`。

环境变量详细分工见 [配置参考](CONFIGURATION.md)。

## 3. 创建随机密码的开发管理员

仅在隔离 JSON 开发库上执行，且先停止读取同一 JSON 的 API，避免运行中缓存与 CLI 写入竞争。这个工具不是正式管理员初始化工具，也不是 MySQL 用户创建工具。

macOS/Linux，先进入服务端目录：

```sh
cd server
NODE_ENV=development DATABASE_DRIVER=json DEV_ADMIN_BOOTSTRAP=create-local-development-admin DEV_ADMIN_USERNAME=local_admin_demo node --env-file=.env src/cli/create-dev-admin.js
cd ..
```

不要设置 `DEV_ADMIN_PASSWORD`，工具会生成随机临时密码，并只在本次终端输出中给出用户名、临时密码和本地账号标识。妥善保存本机凭据，不要截图上传 Issue。该账号标记为本地开发用途，不构成学校实名认证或正式管理授权。

安全门槛：

- 必须显式设置 `DEV_ADMIN_BOOTSTRAP=create-local-development-admin`。
- `NODE_ENV` 只能为开发模式，工具拒绝生产模式。
- `DATABASE_DRIVER=mysql` 时拒绝运行；不要通过强行改为 JSON 来“修复”一个已迁移 MySQL 的环境。
- 只能写入 `server/data` 下的开发数据文件。
- CLI 本身不自动导入 dotenv，故上面明确使用 `node --env-file=.env`，确保密钥和数据路径与随后启动的 API 一致。

账号生成后，可在后台登录，再按需要通过受控流程添加隔离测试人员。不要将开发账号导出到生产数据集；也不要公开任何真实可登录密码。

## 4. 推荐：三终端运行

所有终端从仓库根目录开始。

终端 A：API，默认只监听本机 `8787`。

```sh
pnpm server:dev
```

终端 B：uni-app H5。

```sh
pnpm exec node scripts/run-uni.mjs dev h5 --host 127.0.0.1 --port 5173 --strictPort
```

终端 C：管理后台，明确只监听本机。

```sh
pnpm --dir admin exec vite --host 127.0.0.1 --port 5174 --strictPort
```

| 服务 | 地址 |
| --- | --- |
| API 健康检查 | `http://127.0.0.1:8787/health` |
| 前台 H5 | `http://localhost:5173/#/` |
| 后台登录 | `http://127.0.0.1:5174/#/login` |

根脚本 `pnpm admin:dev` 也能启动后台，默认端口是 `5174`，但其脚本使用 `--host 0.0.0.0`；需要仅本机访问时使用上述显式命令。端口被占用应先识别进程或改配，不能停止其他项目来抢占端口。

根 `VITE_API_BASE_URL` 是前台用的 API 源站；后台默认通过自身开发代理的 `/api/v1` 请求同一 API，无需复制根 `.env` 到 `admin/`。误把后台 API 配成只有源站会丢失 `/api/v1` 前缀。不要在启动三个终端的父 shell 中统一导出同一个 `VITE_API_BASE_URL`。

结束开发时分别按 `Ctrl+C`，等待 API 排空已经接受的写入。

### 4.1 可选：本机后台托管启动器

仓库提供面向已配置本机开发环境的启动器：

```sh
pnpm local:start
pnpm local:status
pnpm local:stop
```

它使用 API `8787`、前台 `5173`、后台 `4180`，把日志和 PID 状态放在 `.local-runtime/`，进程可在终端关闭后继续运行。它只停止能验证归属为本项目的进程，端口被外部进程占用时会拒绝启动。

注意：

- 启动器会显式设置本机 HOST、PORT、数据目录与 API URL，不是任意环境配置的通用启动器。
- `.local-runtime/mysql/active.env` 是专用本地 MySQL 激活约定，不在公开仓库中，也不是可以手写任意 MySQL 地址的配置文件；不存在时不会帮你创建 MySQL 数据库。
- 使用 detached 进程组、`ps`、Unix 权限/UID 等能力，Windows 推荐使用三终端方式，不应直接宣称该托管模式已经跨平台验收。
- 不要同时运行三终端方式和 `local:start`；同一数据源不能启动两个 API 写入进程。

## 5. 构建产物

通用 H5 + 后台部署用以下两条：

```sh
pnpm build:h5
pnpm admin:build
```

| 命令 | 产物/作用 |
| --- | --- |
| `pnpm build:h5` | `dist/build/h5/`，前台 H5 静态文件 |
| `pnpm admin:build` | `admin/dist/`，管理后台静态文件 |
| `pnpm build:mp-weixin` | 微信小程序构建；后续需开发者工具与平台验收 |
| `pnpm build:mp-alipay` | 支付宝小程序构建；后续需开发者工具与平台验收 |
| `pnpm build:app` | uni-app App 资源；不直接等于已签名 APK/IPA |
| `pnpm server:start` | 启动服务端源码；不是打包数据库或生成前端 |

根 `pnpm build` / `pnpm build:sites` 包含特殊 Sites 发布整理步骤，要求 `.openai/hosting.json`，并重组 `dist/` 为 `client/`、`server/` 等目录。公开克隆不应依赖这个未提供的托管环境文件。宝塔/Nginx 普通部署使用 `build:h5` 与 `admin:build`，不是 `build:sites`。

构建时的 `VITE_*` 会写进前端 JS，改环境变量后要重新构建再替换产物；API 运行时变量不会自动更新已构建前台。任何密码、Token、数据库连接或内部文件路径都不能放在 `VITE_*` 中。

## 6. 测试与本地检查

```sh
pnpm validate
pnpm client:test
pnpm admin:test
pnpm server:test
pnpm build:h5
pnpm admin:build
```

`pnpm test` 聚合了项目检查、客户端测试、后台测试/构建和服务端测试；它没有包含 H5 构建，故还要运行 `pnpm build:h5`。自动测试通过不等于微信、支付宝、Android、iOS 全部真机通过，也不等于学校认证、支付、生产地图或超大文件链路已联调成功。

建议人工抽查：

1. 访客/登录用户/首次改密人员/不同管理权限的访问边界。
2. 同设备持久会话及换设备替换旧会话。
3. 发帖评论、敏感词拦截、后台下架、模块关闭后接口拒绝。
4. 人工复核、重复身份、企业申请人绑定、申请/审核通知。
5. 固定群权限、自建群退出解散、文件上传与查看权限。
6. 小屏/桌面布局、地图资源、动态码及实际扫码确认。

### 6.1 真实 MySQL 测试不是默认测试

`server/test/mysql-integration.test.js` 需要独立可清空的测试 MySQL 库，并设置：

- `HUFE_MYSQL_TEST_CONFIG`：受保护 JSON 连接配置文件的路径。
- `HUFE_MYSQL_TEST_ALLOW_RESET=1`：明确允许测试删除该隔离库的适配表。

测试要求数据库名称以 `hufe_mysql_qa_` 或 `hufe_mysql_test_` 开头，并会删除该库中六个命名空间的存储表。绝不能指向本机业务库或正式库。不设置这些条件时出现跳过是预期行为，不能把跳过说成真实 MySQL 已验收。

## 7. MySQL 开发与正式初始化边界

MySQL 模式是显式存储驱动，六个命名空间为 `application`、`chat`、`image-transfers`、`audit`、`regions`、`content`。没有导入有效结构和快照时，启动返回 `MYSQL_NOT_MIGRATED`，不会悄悄退回 JSON，也不会自动创建一套空业务资料。

当前没有“正式空库 + 通用管理员”的一键初始化命令。生产首次建立需要独立审定的有效初始快照和管理员引导流程；生产迁移需要正式源数据、文件、原配套密钥及完整校验。不要运行开发管理员 CLI 后把测试 JSON 当成生产数据源，也不要伪造一个空对象来绕过启动保护。

现有 MySQL 适配器使用单写入锁和已校验内存快照。一个数据库只能有一个 API 写入实例；禁止 PM2 cluster、多 worker 或多副本共写。只读导出与核验有专用路径。详细约束见 [`server/src/storage/README.md`](../server/src/storage/README.md) 和 [部署说明](DEPLOYMENT.md)。

## 8. Windows / PowerShell 差异

复制配置使用：

```powershell
Copy-Item .env.example .env
Copy-Item server/.env.example server/.env
```

创建开发管理员时，先在 `server` 目录设置当前 PowerShell 的环境变量，再运行 Node：

```powershell
Set-Location server
$env:NODE_ENV = 'development'
$env:DATABASE_DRIVER = 'json'
$env:DEV_ADMIN_BOOTSTRAP = 'create-local-development-admin'
$env:DEV_ADMIN_USERNAME = 'local_admin_demo'
node --env-file=.env src/cli/create-dev-admin.js
Remove-Item Env:DEV_ADMIN_BOOTSTRAP
Remove-Item Env:DEV_ADMIN_USERNAME
Set-Location ..
```

完成后关闭这个一次性引导终端，避免把其环境覆盖传递到其他进程。三个运行终端与构建的 `pnpm` 命令相同。`scripts/run-uni.mjs` 已区分 Windows 的 `uni.cmd`；Shell 变量赋值、`chmod`、`ps`、Unix 进程组和宝塔部署脚本不因此自动兼容 Windows。

## 9. 排障入口

| 现象 | 检查方向 |
| --- | --- |
| `node` / `pnpm` 不存在 | 工具链安装与 PATH，重新打开终端 |
| 安装引擎/锁文件报错 | Node 与 pnpm 版本、当前分支、是否用了正确锁文件 |
| 页面打开但 API 404 | 前台源站/后台 `/api/v1` 前缀，Vite `/api` 代理目标，API `/health` |
| 修改 `.env` 没生效 | 是否编辑了正确目录；运行时环境优先于 dotenv；重启开发服务或重新构建 |
| 学校认证不可用 | 正常开发边界；需学校批准的测试 HTTPS 回调，不是将布尔变量设为 true |
| `MYSQL_NOT_MIGRATED` | 没有完整有效初始化/迁移；不要改为 JSON 偷绕过 |
| `MYSQL_WRITER_ALREADY_RUNNING` | 已有 API 写入者；先识别并正常停止，不移除单写保护 |
| 本地托管状态异常 | `.local-runtime/*.log`、归属 PID、端口和健康检查；不公开原始日志中的敏感数据 |

反馈请附工具版本、命令、脱敏错误和重现步骤；不要附 `.env`、用户数据目录或真实凭据。
