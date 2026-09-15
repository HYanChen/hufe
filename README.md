<p align="center"><img src="static/brand/school-wordmark-202609.jpg" alt="湖南财政经济学院 · Hunan College of Finance and Economics" width="640"></p>

# hufe · 湖财人

面向湖南财政经济学院学生、教职工与校友的实名服务平台。**uni-app + Vue 3 用户端 / Vue 3 管理后台 / Fastify API / MySQL**，将校友连接、组织运营、校园交流、企业招聘、返校服务和公益回馈集中管理。

[开始开发](docs/DEVELOPMENT.md) · [使用手册](docs/USER_GUIDE.md) · [功能清单](docs/MODULES.md) · [多端构建](docs/MULTIPLATFORM.md) · [正式部署](docs/DEPLOYMENT.md) · [下载部署包](https://github.com/HYanChen/hufe/releases)

## 项目功能

- **身份与人员**：平台账号、学校 CAS/OIDC 注册实名校验、人工复核、个人资料、密码管理、校友编号、Excel 人员导入与去重。
- **校友连接**：组织主页、成员、相册与留言；学籍关联组织与固定聊天群；校友名录与长沙本地地图。
- **交流协作**：校园墙、话题、提及、图片、匿名发帖/评论、热门与置顶；私聊、自建群、表情与文件传输。
- **服务与资源**：活动报名、返校预约与动态扫码核验、企业认证与招聘、合作、导师、课堂、权益、公益项目及证书模板。
- **运营管理**：板块权限、人员内部关系档案、模块启停、学校认证配置、区域/地图库、敏感词、内容下架、对话管理与操作审计。

详见[模块与权限清单](docs/MODULES.md)。程序具备配置入口，不等于学校认证、企业数据等外部服务已经为新部署开通。

## 多端状态

| 端 | 当前仓库 | 交付边界 |
| --- | --- | --- |
| 浏览器 H5 | 手机与桌面布局、生产构建入口 | 当前主要交付端；新环境仍需配置、数据和上线验收 |
| 管理后台 Web | 独立 Vue/Vite 应用，通常放 `/admin/` | 不参与 uni-app 小程序/App 打包 |
| 微信小程序 | 配套依赖、开发/生产构建脚本 | 需真实 AppID、合法域名、适配及真机验收 |
| 支付宝小程序 | 配套依赖、开发/生产构建脚本 | 需平台应用信息、域名、适配及真机验收 |
| Android / iOS | uni-app App 资源构建入口 | 还需 HBuilderX、签名、权限与真机验收；资源构建不等于 APK/IPA |

**非 H5 的学校注册实名回跳、聊天文件选择/下载和地图打开仍有限制，不能仅填 AppID 就直接上线。** 构建命令、工具导入及各端差异见[uni-app 多端指南](docs/MULTIPLATFORM.md)。

## 快速开始

开发工具链使用 pnpm 11.19.0，其要求 **Node.js 22.13 或更高的兼容版本**；本次干净安装与构建实际验证的是 Node.js 24.19.0 / pnpm 11.19.0，并不代表所有满足最低版本的组合均已验收。生产 API 运行时与依赖安装工具链分开确认，部署建议见下文。根 `pnpm-lock.yaml` 是三个 workspace 的共同依据；不要混用 npm/yarn 或单独升级 DCloud 依赖。后端运行要求高于根包声明的 Node ≥18。

```sh
git clone https://github.com/HYanChen/hufe.git
cd hufe
pnpm install --frozen-lockfile
pnpm validate
```

按照[开发指南](docs/DEVELOPMENT.md)配置前后端环境文件、选择独立开发数据环境，再分别在三个终端运行：

```sh
pnpm server:dev
pnpm exec node scripts/run-uni.mjs dev h5 --host 127.0.0.1 --port 5173 --strictPort
pnpm --filter hufe-unified-platform-admin exec vite --host 127.0.0.1 --port 4180 --strictPort
```

API：`http://127.0.0.1:8787/health`；用户端：`http://127.0.0.1:5173/#/`；后台：`http://127.0.0.1:4180/#/login`。

没有默认生产管理员密码。开发可使用代码保留的 JSON 沙盒，正式部署使用 MySQL；开发账号工具不能初始化生产 MySQL。首次运行与账号创建详见开发指南。

## 构建和测试

```sh
pnpm build:h5
pnpm admin:build
pnpm build:mp-weixin
pnpm build:mp-alipay
pnpm build:app

pnpm validate
pnpm client:test
pnpm admin:test
pnpm server:test
```

H5 输出 `dist/build/h5/`，后台输出 `admin/dist/`。App/小程序输出与后续发布步骤见多端指南。`pnpm test` 包含后台构建，不包含所有终端发布、真实学校 SSO 或真机验收；真实 MySQL 集成测试另需隔离库与显式重置许可。

## 正式部署

1. 从 [Releases](https://github.com/HYanChen/hufe/releases) 下载 **完整版 ZIP 和 SHA256 文件**；GitHub 自动生成的 Source code ZIP 是纯源码，不是完整部署包。
2. 验证 SHA，解压到新目录，运行 `node verify-handoff.cjs .`，再阅读包内部署说明。
3. 独立配置前台、后台、API、MySQL、HTTPS 和持久文件目录，完成数据/密钥交接、备份及验收后切换流量。

重要边界：

- 正式环境使用 MySQL 六命名空间，当前仅支持**单 API 写入进程**，不能直接 PM2 cluster 或多副本写同库。
- 当前没有通用生产空库首管理员初始化工具。完全新站须由维护方提供合法初始快照和受审计的管理员初始化方案。
- 仓库和软件包不含生产密码、密钥、业务数据库或用户材料；这些需要安全交接，不能从测试夹具获取。
- `baota-*` / `mysql-baota-*` 是历史专站工具，不是宝塔通用一键安装器；已有 MySQL 禁止重复导入旧 JSON。
- 升级保留原 `DATA_HASH_SECRET`、数据库和私有文件；源码文档更新不自动改变旧 Release 成品。

见[正式部署指南](docs/DEPLOYMENT.md)和[生产配置模板](deploy/handoff/runtime.env.example)。

## 项目结构

```text
pages/               uni-app 页面（仓库根作为 UNI_INPUT_DIR）
components/          用户端组件
services/ utils/     接口、会话与通用逻辑
admin/               独立 Vue 管理后台
server/src/          Fastify、身份、业务、MySQL 和文件服务
server/data/         仅跟踪公共 IP 数据，运行数据不入 Git
shared/ static/      共享定义、品牌与静态资源
scripts/             构建、检查、开发与历史运维脚本
test/                客户端与工具回归测试
deploy/handoff/      配置模板与交接说明
docs/                完整项目文档
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [开发与首次运行](docs/DEVELOPMENT.md) | 安装、账号、环境、启动、调试与测试 |
| [使用手册](docs/USER_GUIDE.md) | 前台用户、组织/企业管理人员与后台管理员 |
| [功能与权限](docs/MODULES.md) | 模块、权限、配置条件和外部集成边界 |
| [多端构建](docs/MULTIPLATFORM.md) | H5、微信、支付宝、Android/iOS |
| [配置说明](docs/CONFIGURATION.md) | API 地址、MySQL、学校认证、代理与文件 |
| [架构与数据](docs/ARCHITECTURE.md) | 三端关系、数据持久化、单写入限制 |
| [部署迁移](docs/DEPLOYMENT.md) | Linux/宝塔部署、校验、交接、回退 |
| [常见问题](docs/FAQ.md) | 登录、接口、地图、安装与构建 |
| [公开版发布检查](docs/PUBLIC_RELEASE_CHECKS.md) | 本次构建、回归结果与未验收范围 |
| [贡献说明](CONTRIBUTING.md) / [安全说明](SECURITY.md) | 参与开发与脱敏反馈 |
| [品牌与许可](NOTICE.md) / [变更记录](CHANGELOG.md) | 素材权利、发布边界与更新 |

## 公开与许可

仓库公开用于展示和协作，目前**没有为自有代码附加 MIT、Apache 等开源许可证**。公开可见不代表获得任意商业使用、再分发或学校品牌授权；学校校徽/中英文校名及第三方素材遵循各自权利与许可，详见 [NOTICE](NOTICE.md)。

请通过 [Issues](https://github.com/HYanChen/hufe/issues) 提交脱敏问题/建议，不上传密码、学号、证件、聊天、SQL 或访问令牌。安全问题见 [SECURITY](SECURITY.md)。
