# MySQL 业务存储

`MySqlDatabase` 是现有同步业务读取接口的持久化适配层。MySQL 是唯一持久化事实来源；MySQL 模式不读写原业务 JSON 文件，也不会在连接失败时回退到 JSON 或启动空库。

## 数据结构

每个命名空间使用三张 InnoDB 表：

- `*_meta`：结构版本、事务修订号、对象布局及完整快照 SHA-256。
- `*_collections`：逻辑集合路径和记录数量（包括空集合）。
- `*_records`：每个账号、消息、业务记录独立一行，包含稳定记录键、排序键、JSON 内容和记录 SHA-256。

命名空间为 `application`、`chat`、`image-transfers`、`audit`、`regions`、`content`。业务集合及未识别的字段完整保留，文件内容仍在文件存储中，仅其关联元数据进入数据库。JSON 列用于兼容已有记录的嵌套字段，不是将整个数据库保存为单个大 JSON 字段。

稀疏有符号排序键允许消息追加和审计前插只写新记录；顺序重排或间隙不足时才重新分配排序键。

请求审计使用专用 `append('requests', event)`：启动时建立一次 SHA-256 流式状态，后续每次追加只计算新增记录，写入一条记录及集合/版本计数，不扫描历史审计。它生成的 SHA 与完整规范化快照 SHA 完全相同，只读导出仍逐行重新校验。通用事务（例如维护或裁剪历史记录）会使增量状态失效，下一次追加重新建立；提交失败或结果不确定时不发布缓存，也不继续使用旧的增量状态写入。

## 运行约束

现有业务服务的 `.read()` 为同步读取。因此每个命名空间在启动时加载已校验的事务快照，并持有专用连接上的 MySQL `GET_LOCK` 单写入锁。第二个写入进程会被明确拒绝，禁止使用多 worker/多副本。若未来需要多副本，必须先将业务查询改造为异步 SQL 查询，不能移除该保护锁。

事务串行执行，SQL 成功提交后才更新读取快照。连接丢失、事务结果不确定或修订号冲突后立即停用读写，必须重启并从 SQL 重新加载；不自动重连。健康检查持续验证连接和锁归属。正常关闭会排空已接受的事务并拒绝新事务。

不得通过其他 SQL 客户端直接改写业务表；写入锁只约束遵守锁协议的应用进程。管理员的修改应通过带审计的业务接口完成。

## 显式迁移与备份

通过受保护的环境文件提供 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`，可选 `MYSQL_SOCKET_PATH`。不要将密码放进命令行参数或日志。

1. 先停止旧应用的所有业务写入并备份完整数据目录与配置。
2. 将每个命名空间整理成一个 JSON 对象快照，在独立空 MySQL 库中显式导入。
3. 分别执行只读完整校验，全部通过后才启用 `DATABASE_DRIVER=mysql`。
4. 保留旧数据备份；恢复对外写入后，回滚前必须先导出最新 MySQL 数据，不能直接启动旧 JSON 快照造成数据倒退。

```sh
node src/cli/mysql-data.js import --namespace application --file /secure/application-data.json
node src/cli/mysql-data.js verify --namespace application --file /secure/application-data.json
node src/cli/mysql-data.js export --namespace application --file /secure/new-backup.json
```

`import` 持有排他写入锁，仅允许该命名空间三张表均为空；SQL 回读及完整 SHA 校验成功后才提交，禁止覆盖已有数据。`verify`/`export` 使用只读可重复读事务，可在应用在线时获得一致快照，无 DDL 和业务写入。导出文件权限为 `0600`，目标已存在时拒绝覆盖。

## 测试

快照拆分、完整性、排序键与 CLI 参数校验：`node --test test/mysql-snapshot.test.js test/mysql-append.test.js`。追加测试在 1.2 万条记录基础上禁止遍历旧数组，并检查固定数量 SQL 与完整 SHA 等价。

真实 MySQL 测试使用独立配置文件，由 `HUFE_MYSQL_TEST_CONFIG` 指定，并显式设置 `HUFE_MYSQL_TEST_ALLOW_RESET=1`。测试数据库名必须以 `hufe_mysql_qa_` 或 `hufe_mysql_test_` 开头；测试会删除此隔离库中的六组适配表。不得指向本地业务库或正式库。
