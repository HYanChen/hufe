# 正式环境部署与升级

本指南面向 Linux / 宝塔运维。推荐 **Node.js 22 + MySQL 8.4 + Nginx HTTPS**，用户端 H5 与管理后台为静态文件，API 为一个独立 Node.js 进程。

**软件公开不等于生产数据公开，也不等于具备空库一键建站能力。** 本仓库不提供真实业务数据库、用户上传文件、账号密码、签名证书或生产密钥。

## 1. 选择正确的交付物

从 [GitHub Releases](https://github.com/HYanChen/hufe/releases) 获取目标版本，并区分：

| 下载项 | 内容与用途 |
| --- | --- |
| 维护者上传的“正式部署完整版”ZIP | 完整源码、已构建 H5 / 后台、后端运行文件、匹配的 Linux 依赖、部署模板、文件清单与校验工具 |
| ZIP 配套 `.sha256` | 校验外层 ZIP 是否传输完整；应与同一发布版本对应 |
| GitHub 自动生成的 `Source code (zip)` / `Source code (tar.gz)` | 该 tag 的 Git 源码快照，**不是完整版运行交付包**；不自动包含前后台构建成品、完整运行依赖及交付校验清单 |
| Git clone | 用于开发、自行构建与维护；先阅读[开发指南](DEVELOPMENT.md)，不要直接把仓库根目录作为网站目录 |

已下载的旧版本 ZIP 不会因仓库文档更新而自动变更。核对 release 标签、文件名和清单中的版本，不要混用不同版本的源码、运行包和依赖。

## 2. 下载后先做双层校验

在没有现有业务文件的工作目录中操作。以下 `RELEASE.zip` 是占位名，替换成实际 ZIP 及其配套文件名：

```bash
# Linux
sha256sum -c RELEASE.zip.sha256

# macOS 使用：shasum -a 256 -c RELEASE.zip.sha256
```

解压 ZIP 到一个全新的空目录，然后进入解压后的交付根目录：

```bash
node verify-handoff.cjs .
```

该工具依据 `handoff-manifest.json` 检查文件大小、SHA-256 以及额外/缺失文件，连内部运行归档也在检查范围内。**出现 SHA 不匹配、缺失文件或额外文件应立即停止，重新核对下载；不要跳过验证或重新生成清单来“修复”错误包。**

完整版的一般布局：

```text
README.md
deployment/              部署说明、环境、Nginx 和 systemd 模板
runtime/                 原始运行 tar.gz 及其校验文件
source/                  完整源码与测试
verify-handoff.cjs
handoff-manifest.json
```

根据 `runtime/` 的真实文件名，将运行归档解压到新的版本目录。先查看归档内容；结果应包含 `frontend/`、`admin/`、`server/`、`server-dependencies.tar.gz`、`release-manifest.json`。**不要直接运行归档内的 `update.sh`**，见下节。

## 3. 先判断是部署、升级还是迁移

| 场景 | 必须遵守的处理方式 |
| --- | --- |
| 已有 MySQL 站点仅更新代码 | 备份后停旧 API，保留原数据库、密钥和完整文件目录，再启动新版；不得重新导入旧 JSON |
| 新服务器承接已有系统 | 在同一停写窗口转移数据库、完整持久文件和原密钥，校验后切换流量 |
| 从旧 JSON 系统迁移 | 制定针对该站的迁移方案，显式导入独立空目标库并校验六个命名空间；禁止覆盖非空数据 |
| 完全没有历史数据的新站 | 先准备合法初始数据和受审计的首管理员方案；当前代码不会自动初始化空业务库 |

源码中的 `mysql-baota-update.sh`、运行归档中的 `update.sh` 及其他历史专站发布脚本是**为特定旧站路径、容器和一次性迁移编写的操作脚本**，不是通用安装器。不得在新服务器或已经改为 MySQL 的站点直接重跑。

`create-dev-*`、`*-qa-*`、`local-*` 脚本用于开发或隔离验收，不可用于正式账号初始化、正式数据修复或生产切换。

## 4. 数据与凭证必须单独安全交接

承接现有站点时，部署人员需要获得授权后单独接收：

- 同一停写窗口的完整 MySQL 备份或六份校验通过的命名空间快照。
- 完整持久文件目录，包括私有证明材料、企业材料、照片、相册、聊天文件/分片、证书背景、后台上传地图等；不能只复制公开图片。
- **原 `DATA_HASH_SECRET`**。已有数据升级/搬迁时不能重新生成，否则敏感字段解密和身份关联可能失效。
- 数据库应用用户、学校认证配置、可信管理员授权、域名 DNS 和 TLS 运维信息。
- 由账号本人确认的正式管理员访问方式；系统保存密码哈希，不存在可供从数据库导出的全部明文密码。

上述内容不得上传到 GitHub、公开 Release、网站根目录或普通工单附件。详细勾选项见[数据与凭证交接清单](../deploy/handoff/数据与凭证另行交接清单.md)。代码更新时可以继续保存在原受保护位置，不需要为了“交接”重新传播密钥。

## 5. MySQL 的必要运行约束

正式环境设置 `DATABASE_DRIVER=mysql`。当前存储层有六个命名空间：

`application`、`chat`、`image-transfers`、`audit`、`regions`、`content`。

每个命名空间由三张 InnoDB 表保存布局、集合及逐条业务记录，并进行记录/快照 SHA 校验；文件二进制仍保存在文件目录中。当前并不是可以随意直接修改表内容的传统 CRUD 数据库。

- 使用独立库、`utf8mb4` 和最小权限应用用户；MySQL 不开放到公网，不用 root 作为应用账号。
- **只运行一个 API 写入进程**。不使用 PM2 cluster、多 worker 或多副本同时写同一个业务库。
- API 启动时读取快照，并用 MySQL `GET_LOCK` 保证单写入；第二实例会被拒绝。不要删掉锁来实现“扩容”。
- 连接丢失、写入结果不确定或修订冲突会停止读写；不要期待自动回退 JSON。处理数据库问题后重启，重新从 SQL 加载。
- 不通过 SQL 客户端手工修改业务 JSON、修订号和 SHA。正常管理走有权限控制和审计的 API。

详情见[MySQL 存储设计](../server/src/storage/README.md)。

### 显式快照迁移

以下以 `application` 为例，路径均为示意，环境文件必须已安全配置，工作目录为对应版本的 `server/`：

```bash
node --env-file=/secure/source.env src/cli/mysql-data.js export --namespace application --file /secure/new-export/application.json
node --env-file=/secure/target.env src/cli/mysql-data.js import --namespace application --file /secure/new-export/application.json
node --env-file=/secure/target.env src/cli/mysql-data.js verify --namespace application --file /secure/new-export/application.json
```

其余五个命名空间逐一完成。导出拒绝覆盖已有文件，导入拒绝覆盖非空命名空间，`verify` 只读。在线导出单命名空间的一致性不等于六份数据属于同一业务时点，因此正式搬迁仍需停写。失败时保留现场，不清库强制重试。

### 空库与首管理员

没有合法初始快照时，MySQL 启动会报 `MYSQL_NOT_MIGRATED`。**目前没有通用生产 `bootstrap-admin` CLI，也没有默认管理员密码。**

已有系统应继承正式账号和权限。全新站点需要维护方给出受审计的数据初始化方案；若合法初始快照已准备且学校 SSO 已接通，可由受控学校 subject / 可信角色完成首管理员授权，具体流程见[完整交付部署说明](../deploy/handoff/正式环境部署说明.md)。仅设置 `ADMIN_SUBJECTS` 不会凭空创建账号，平台用户名也不等于学校 subject。

## 6. 宝塔 / Nginx / Node 安装顺序

1. **准备站点**：在宝塔创建目标域名站点，配置 DNS、有效 TLS 证书与续期方式。先备份该站点配置，不改其他站点或宝塔全局 Nginx 配置。
2. **分离目录**：版本代码、持久数据、环境配置、备份分别存放。静态站根只放 `frontend/` 的内容及其 `admin/` 子目录中的后台构建文件。
3. **安装 API 文件**：运行包的 `server/` 放到网站根目录之外的新版本目录，将匹配的 Linux `server-dependencies.tar.gz` 解压到该 `server/`，确认得到 `server/node_modules/`。不要拷贝开发电脑的 `node_modules`。
4. **恢复数据**：配置独立 MySQL 库，恢复并校验六命名空间及完整文件目录；核对原数据密钥。
5. **填写配置**：复制[运行环境模板](../deploy/handoff/runtime.env.example)到受保护位置，替换全部占位符；参考[配置指南](CONFIGURATION.md)。文件权限采用 `0600` 或受控 `0640`，不要 `chmod -R 777`。
6. **启动单 API**：使用专用低权限用户。按[systemd 模板](../deploy/handoff/hufe-api.service.example)核对 Node 22 的安装路径、工作目录与可写数据目录；也可使用宝塔 Node 项目/PM2 fork 单实例，但不要同时存在多个管理器启动同一个 API。
7. **本机健康检查**：确认旧 API 已停止后启动候选 API，先访问 `http://127.0.0.1:8787/health`，确认数据库驱动和就绪情况。端口应按实际配置替换，API 不直接暴露公网。
8. **合并站点代理**：使用[Nginx 站点模板](../deploy/handoff/nginx-site.conf.example)，保持 `/api/` 原前缀转发，`/health` 转发到 API，前台和后台各自静态回退。先 `nginx -t` 成功再重载；宝塔环境使用其实际 Nginx 可执行文件路径。
9. **验收后开放流量**：验收期间不要允许旧、新实例同时写库。错误优先保持维护状态、查看脱敏日志和校验结果，不临时关闭鉴权。

原生同机模板中的回环地址与可信代理只适用于该拓扑。容器部署须明确 API/MySQL 私网、监听地址、只读代码挂载和可写文件卷；只读代码目录下的挂载点要预先存在。`TRUST_PROXY=true` 不是通用配置，使用精确可信代理范围。

### 上传和地图代理注意

- 图片和聊天大文件走应用分片上传。不要因为总文件允许 5 GB 就把任意单请求上限无限调大；示例的单请求限制应与应用分片大小协调。
- `/api/v1/maps/viewer/index.html`、底图、字体和瓦片必须进入 API；误用 SPA 回退会在地图框里出现前台首页。
- `DATA_FILE` 即使在 MySQL 模式仍影响聊天/地图等文件目录定位。不能因“不再用 JSON”而删除其父目录。
- API 模式下的元数据备份和文件备份缺一不可。只备份 MySQL 不足以恢复照片和聊天附件。

## 7. 正式验收与回退

- [ ] 首页和 `/admin/` 可访问，品牌正确，手机/桌面操作不被遮挡。
- [ ] `/health` 表示 MySQL 就绪；未登录不能访问管理接口、内部人员档案、私有文件和聊天审计。
- [ ] 经授权的管理员能登录，业务数据及权限与迁移前一致，首登改密和单设备会话符合预期。
- [ ] 模块关闭后前后台入口与直接访问限制一致；内部备注不出现在前台个人资料中。
- [ ] 图片、聊天、下载权限、地图、证书和需要的后台写入均通过真实 API 验证。
- [ ] 学校认证已按登记回调完成真实授权测试；企业资料等外部接口按配置和可用性验证，未接通的不宣称已接通。
- [ ] 重启一次 API 后再次验证数据、文件、权限与数据库健康。
- [ ] 保存本次版本清单、SHA、验收结果，以及可恢复的旧版本和数据备份。

流量开放前失败，可以停候选版本并恢复已验证的旧版本。**开放新写入后禁止用旧 JSON / 旧 SQL 快照覆盖数据库。** 回退前先停写并备份当前数据，确认旧代码兼容当前结构；需要数据回退时由维护方制定明确恢复方案。

H5 上线不代表微信、支付宝、Android 或 iOS 同时上线；这些端需要[独立构建与真机验收](MULTIPLATFORM.md)。常见故障见 [FAQ](FAQ.md)。
