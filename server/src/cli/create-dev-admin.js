import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfig } from '../config.js'
import { JsonDatabase } from '../storage/json-database.js'
import { AccountService } from '../accounts/service.js'

if (String(process.env.DATABASE_DRIVER || '').toLowerCase() === 'mysql') throw new Error('MySQL 模式不支持旧版 JSON 演示账号工具，请通过后台账号管理添加人员，禁止写入迁移前的数据文件')

const confirmation = 'create-local-development-admin'
if (process.env.DEV_ADMIN_BOOTSTRAP !== confirmation) {
  throw new Error(`拒绝执行：请显式设置 DEV_ADMIN_BOOTSTRAP=${confirmation}`)
}
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
  throw new Error('拒绝执行：NODE_ENV 必须为 development')
}

const config = createConfig({ env: 'development' })
const localDataDirectory = fileURLToPath(new URL('../../data/', import.meta.url))
const relativeDataPath = path.relative(localDataDirectory, config.dataFile)
if (relativeDataPath.startsWith('..') || path.isAbsolute(relativeDataPath)) {
  throw new Error('拒绝执行：本地演示管理员只能写入 server/data 目录下的开发数据库')
}

const username = String(process.env.DEV_ADMIN_USERNAME || 'hufe_demo_admin').trim()
const password = process.env.DEV_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url')
const database = await new JsonDatabase(config.dataFile).init()
const accounts = new AccountService(database, config)
const account = await accounts.createDevelopmentAdmin({ username, password }, { actor: 'local-development-cli' })

process.stdout.write(`${JSON.stringify({
  environment: config.env,
  dataFile: config.dataFile,
  username: account.username,
  temporaryPassword: password,
  accountId: account.id,
  localDevelopmentOnly: account.localDevelopmentOnly,
  loginEndpoint: '/api/v1/auth/login'
}, null, 2)}\n`)
