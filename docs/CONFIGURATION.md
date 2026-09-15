# 配置参考

本页说明当前源码实际读取的配置。模板用于填值，不表示认证、企业查询或其他第三方已经接入。运营步骤见 [使用手册](USER_GUIDE.md)，安装运行见 [开发指南](DEVELOPMENT.md)，上线流程见 [部署说明](DEPLOYMENT.md)。

工具链版本不通过 `.env` 设置：pnpm 11.19.0 要求 Node.js 22.13 或更高的兼容版本，本次验证组合为 Node.js 24.19.0 / pnpm 11.19.0。满足版本下限不等于完成验收；生产 API 运行时按部署方案单独核对。

## 1. 四个配置层不要混用

| 配置层 | 文件/入口 | 生效时机 | 安全边界 |
| --- | --- | --- | --- |
| uni-app 客户端 | 根 `.env`、`.env.local`、相应模式文件 | Vite 启动/构建时 | `VITE_*` 是公开客户端配置，绝不能存秘密 |
| 管理后台 | `admin/` 下 Vite 环境文件或启动环境 | 后台 Vite 启动/构建时 | 同样会打进浏览器代码 |
| API 服务端 | `server/.env` 或受保护的运行时环境文件 | API 启动时 | 数据库密码、身份密钥和服务凭据只在此层或服务端配置存储 |
| 后台业务配置 | 学校实名配置、企业查询、模块、区域、地图、敏感词等管理界面 | API 读取最新有效配置 | 需要对应管理权限，保存与敏感操作留痕 |

API 的 `dotenv/config` 默认读取进程工作目录的 `.env`；已经存在于进程环境中的值优先。命令行 CLI 不一定导入 dotenv，使用前核对脚本；例如开发管理员和 MySQL 数据工具建议通过 `node --env-file=...` 显式加载。

Vite 的 `HUFE_API_PROXY` 是配置代码从 `process.env` 直接读取的开发代理变量，不保证仅写进普通 `.env` 就已注入该处。非默认端口建议在启动进程环境显式设置。前端构建配置变更后须重新构建；生产运行时更改环境文件不会自动改写静态 JS。

## 2. 最容易配错的 API 地址

| 使用位置 | `VITE_API_BASE_URL` 填法 | 原因 |
| --- | --- | --- |
| 前台本地 H5 | `http://localhost:8787` | 前台请求自身已包含 `/api/v1/...` |
| 前台同源生产 H5 | 留空 | 请求同源 `/api/v1/...`，由反向代理送到 API |
| 前台 App/小程序 | 自己实际拥有的正式 HTTPS API 源站，不带 `/api/v1` | 非浏览器同源环境必须显式指定网关；还需平台合法域名及端能力验收 |
| 后台本地代理或同源生产 | 默认 `/api/v1` | 后台相对请求拼接在版本化 API 根路径下 |
| 后台独立 API 域名 | 正式 HTTPS 源站加 `/api/v1` | 不要仅填源站，否则管理接口缺少前缀 |

不要把前台根 `.env` 原样复制给后台，也不要给三个进程共享导出同一个 `VITE_API_BASE_URL`。前台 Vite 对 `/api`、`/health` 提供代理，地图/字体/瓦片相对路径也依赖该代理；API 错误被 SPA 首页回退吞掉时可能出现“地图里显示首页”。

## 3. 前台构建变量

| 变量 | 默认/含义 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 开发默认 `http://localhost:8787`，生产 H5 默认同源 | 按上表区分前后台；不能包含凭据 |
| `VITE_API_TIMEOUT` | `10000` 毫秒 | 客户端普通请求超时，不等同于大文件整体传输时限 |
| `VITE_IDENTITY_FRESH_TTL_MS` | `300000` 毫秒 | 本人身份展示缓存新鲜度，不是学校重新认证或登录会话期限 |
| `VITE_SCHOOL_REGISTRATION_READY` | 历史兼容变量 | 不再是学校认证入口的权威开关；实际状态由后台配置接口返回 |
| `HUFE_API_PROXY` | 开发代理源站，默认 `http://127.0.0.1:8787` | 通过启动进程环境设置，开发使用；不是生产 Nginx 配置 |

`.env.production.example` 中的域名是占位示例；部署者应复制为自己的配置并替换。模板中的 `VITE_DEMO_MODE` 不应被理解为服务端安全开关，正式身份与开发夹具由服务端账号标识及环境共同限制。

## 4. API 基础、存储与安全

以下默认值来自 [`server/src/config.js`](../server/src/config.js)；生产环境不要依赖开发默认值。

| 变量 | 默认/格式 | 用途与注意事项 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 正式设为 `production`，触发生产配置校验 |
| `HOST` | `127.0.0.1` | 本地/宿主机反代通常只监听本机；容器监听按受控网络设计 |
| `PORT` | `8787` | API 端口；修改后同步代理与健康检查 |
| `PUBLIC_BASE_URL` | 开发 `http://localhost:8787` | 承载 API 与学校回调的公开源站；正式必须 HTTPS |
| `CORS_ORIGINS` | 逗号分隔、默认若干本地开发源站 | 只允许真实前台/后台源站，正式不含 localhost 或 HTTP |
| `RETURN_URL_ORIGINS` | 逗号分隔的客户端回跳源站 | 学校注册回跳白名单；与 CORS 用途不同 |
| `TRUST_PROXY` | `false` | 开启前确定受控代理会覆盖伪造转发头 |
| `TRUSTED_PROXY_CIDRS` | 具体代理 IP/CIDR | 不允许信任全网来源；不是用户 IP 白名单 |
| `DATA_HASH_SECRET` | 仅开发有默认占位值 | 正式至少 32 字符独立随机密钥；长期保存并配套备份，不可随升级更换 |
| `DATABASE_DRIVER` | `json` 或 `mysql` | 本机隔离开发可 JSON；正式采用已迁移并校验的 MySQL |
| `DATA_FILE` | `./data/application-data.json` | JSON 开发数据位置；MySQL 下也用于派生部分文件存储目录，不表示继续读旧业务 JSON |
| `CONTENT_CACHE_FILE` | `./data/content-cache.json` | 内容缓存/存储路径基准；不能据此认为已开启 JSON 回退 |
| `MEDIA_DIR` | `./data/media` | 持久媒体目录，同时含受保护的材料/社区文件子目录；禁止将整个目录直接公开为静态资源 |
| `AUDIT_GEO_DIR` | 空时按数据目录定位 IP 库 | 离线 IP 归属数据，不向外部服务自动发送用户 IP |
| `CHAT_STORAGE_LIMIT_BYTES` | `21474836480`（20 GiB） | 私有聊天附件总配额；不是单文件上限 |
| `ADMIN_SYNC_KEY` | 空 | 手工内容同步的可选服务密钥；不应代替正常管理授权，也不能公开 |

相对数据路径由服务端根目录解析，不以浏览器路径为准。上传文件、证明材料、聊天附件、地图文件等不因为数据库改为 MySQL 就进入数据库 BLOB；完整备份必须覆盖数据库、持久文件及原配套密钥。

身份散列、加密配置和受保护字段依赖 `DATA_HASH_SECRET`。丢失或替换后，可能无法匹配原身份或解密已有字段。生产不能使用模板字符串、开发默认密钥或每次启动新生成的临时密钥。

## 5. MySQL 变量与运行约束

| 变量 | 默认/要求 |
| --- | --- |
| `MYSQL_HOST` | 默认 `127.0.0.1`；容器环境按私有网络配置 |
| `MYSQL_PORT` | 默认 `3306` |
| `MYSQL_USER` | MySQL 模式必填，使用独立应用账号 |
| `MYSQL_PASSWORD` | MySQL 模式必填，只存于受保护环境/密钥系统 |
| `MYSQL_DATABASE` | MySQL 模式必填，使用独立业务库 |
| `MYSQL_SOCKET_PATH` | 可选 Unix socket 路径 |

当前六组命名空间为 `application`、`chat`、`image-transfers`、`audit`、`regions`、`content`。MySQL 服务启动前必须已有有效结构与数据快照，空库会报 `MYSQL_NOT_MIGRATED`；只建一个数据库或把变量设为 `mysql` 并不能完成初始化。

没有通用正式空库初始化/超级管理员种子命令。开发 JSON 管理员工具明确拒绝 MySQL；升级时也不能从旧 JSON 覆盖正在使用的 MySQL。迁移导入、只读导出/验证以及原密钥和文件交接必须按独立部署流程执行。

适配器持有每命名空间单写入锁，生产 API 必须单进程单副本，不支持 PM2 cluster。不要用外部 SQL 客户端直接改写业务存储表绕过完整性散列和审计。配置错误或连接故障不会回退到 JSON。

## 6. 学校认证配置

推荐保留 `SSO_MANAGED_IN_ADMIN=true`，由全局管理员在“学校实名校验配置”中保存、检查并启用。允许连接的学校认证域名上限由服务端 `SCHOOL_AUTH_ALLOWED_HOSTS` 控制，不能靠后台随意扩大。

| 变量组 | 含义 |
| --- | --- |
| `SSO_MANAGED_IN_ADMIN` | 默认 `true`；只有明确采用旧环境变量管理时设 `false` |
| `SCHOOL_AUTH_ALLOWED_HOSTS` | 逗号分隔的精确认证主机名许可列表 |
| `SSO_PROTOCOL` | `auto`、`cas` 或 `oidc`；旧环境方式的 auto 在有 OIDC client ID 时选择 OIDC |
| `CAS_BASE_URL`、`CAS_LOGIN_PATH`、`CAS_VALIDATE_PATH` | CAS 地址与登录/验证路径，必须按学校实际接入资料设置 |
| `CAS_SERVICE_URL` | 与 `PUBLIC_BASE_URL` 同源的 `/api/v1/auth/registration/callback`，精确 HTTPS 地址，不带查询/片段 |
| `CAS_REQUEST_TIMEOUT_MS` | CAS 请求超时，默认 `8000` |
| `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET` | 已申请的 OIDC 客户端配置，secret 仅存服务端 |
| `OIDC_SCOPES` | 默认 `openid profile email phone`，以获批范围为准 |
| `OIDC_TOKEN_AUTH_METHOD` | 默认 `client_secret_basic` |
| `OIDC_REQUEST_TIMEOUT_MS` | 默认 `8000` |
| `SSO_SESSION_TTL_MS` | 认证事务有效期，默认 `600000` |
| `REGISTRATION_TICKET_TTL_MS` | 一次性注册凭证有效期，默认 `600000` |

字段映射包括 `CAS_ATTRIBUTE_NAME`、`CAS_ATTRIBUTE_STUDENT_ID`、`CAS_ATTRIBUTE_ID_CARD`、`CAS_ATTRIBUTE_DEPARTMENT`、`CAS_ATTRIBUTE_MAJOR`、`CAS_ATTRIBUTE_CLASS_NAME`、`CAS_ATTRIBUTE_ENROLLMENT_YEAR`、`CAS_ATTRIBUTE_GRADUATION_YEAR`、`CAS_ATTRIBUTE_EXPECTED_GRADUATION_YEAR`、`CAS_ATTRIBUTE_AFFILIATION`、`CAS_ATTRIBUTE_ALUMNI_STATUS`、`CAS_ATTRIBUTE_PERSON_TYPE`、`CAS_ATTRIBUTE_ROLES`。按真实回包逐项核对字段名和值域，不能依据名称猜测学校一定提供这些字段。

其他身份相关变量：

- `CAS_ALUMNI_STATUS_VALUES`：被识别为已确认校友状态的值集合。
- `ADMIN_SUBJECTS`、`ADMIN_ROLE_VALUES`：可信学校主体/角色授权条件；绝不能配置成所有用户都能匹配的值。
- `ALUMNI_VERIFY_API_URL`、`ALUMNI_VERIFY_API_TOKEN`：可选的学校获批校友库核验接口与私有凭据；不是默认已接入的外部接口。

学校认证仅用于身份校验与新用户注册，不是平台日常密码登录。H5 临时 Cookie 绑定、HTTPS callback 和一次性凭证都必须保留；App/小程序的安全回跳尚未验收时服务端会拒绝对应端首次注册，不能通过关闭校验“兼容”。

`ACCESS_TOKEN_TTL_MS` 仍保留在兼容配置中，但当前日常平台登录使用持久单设备会话；它不是“多少小时强制用户掉线”的权威设置。实际会话随退出、设备替换、改密或账号状态而撤销，详见 [`server/src/auth/persistent-sessions.js`](../server/src/auth/persistent-sessions.js)。

## 7. 官网同步和后台业务配置

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `CONTENT_SYNC_INTERVAL_MS` | `900000` | 内容定时同步间隔 |
| `CONTENT_REQUEST_TIMEOUT_MS` | `10000` | 来源请求超时 |
| `CONTENT_PAGE_SIZE` | `12` | 内容页大小 |
| `CONTENT_SYNC_PAGES` | `2` | 每次同步页数 |
| `CONTENT_DETAIL_LIMIT_PER_SOURCE` | `8` | 单来源详情获取上限 |

模块开关、企业资料查询密钥与每日额度、行政区域、地图/图层、敏感词、证书模板、门岗授权等由对应后台页面和受限 API 管理，不是随意新增一个 `.env` 变量就能开启。

企业登记查询需要部署者自备已获授权的企查查接口和计费额度；证书需要学校真实到账确认；地图需要允许使用的数据资源和坐标/范围验收。不要将后台配置入口存在写成相应服务已经接通。

## 8. 仅用于开发/测试的变量

| 变量 | 使用范围 |
| --- | --- |
| `DEV_ADMIN_BOOTSTRAP` | 显式值 `create-local-development-admin` 才允许 JSON 开发管理员引导 |
| `DEV_ADMIN_USERNAME` | 可选开发用户名，不是学校实名身份 |
| `DEV_ADMIN_PASSWORD` | 不设时生成随机密码；不应预置可公开复用的密码 |
| `HUFE_MYSQL_TEST_CONFIG` | 隔离测试库的私有 JSON 连接配置路径 |
| `HUFE_MYSQL_TEST_ALLOW_RESET` | 值 `1` 才运行会清理适配表的真实 MySQL 测试 |

真实 MySQL 测试配置必须指向专门可丢弃的测试库，不得用正式 `MYSQL_*` 连接信息替代。开发引导变量不应留在生产环境文件、服务启动器或 CI 发布任务里。

## 9. 配置自查

- 前台 API 为源站，后台 API 含 `/api/v1`；相对地图资源能到达 API 而不是 SPA 首页。
- 正式 HTTPS、CORS 和回跳源站正确，不包含本地地址。
- `DATA_HASH_SECRET` 与原数据配套，私有环境文件不入 Git。
- MySQL 六个命名空间已按流程建立并校验，当前只有一个 API 写入者。
- 文件存储已持久化并备份，没有仅备份数据库遗漏附件。
- 学校认证处于真实配置状态，未接入不虚报可用；后台对接密钥仅由授权者管理。
- 代理仅信任真实代理来源，审计 IP 不由任意客户端转发头控制。
- 日志、公开 Issue、截图和 Release 不包含真实密码、身份号、用户资料或聊天内容。
