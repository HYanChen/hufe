import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfig } from '../config.js'
import { JsonDatabase } from '../storage/json-database.js'
import { AccountService } from '../accounts/service.js'

if (String(process.env.DATABASE_DRIVER || '').toLowerCase() === 'mysql') throw new Error('MySQL 模式不支持旧版 JSON 演示账号工具，请通过后台账号管理添加人员，禁止写入迁移前的数据文件')

const confirmation = 'create-local-development-user'
if (process.env.DEV_USER_BOOTSTRAP !== confirmation) {
  throw new Error(`拒绝执行：请显式设置 DEV_USER_BOOTSTRAP=${confirmation}`)
}
if (process.env.NODE_ENV !== 'development') {
  throw new Error('拒绝执行：必须显式设置 NODE_ENV=development')
}

const username = String(process.env.DEV_USER_USERNAME || '').trim()
const password = String(process.env.DEV_USER_PASSWORD || '')
if (!username || !password) throw new Error('拒绝执行：必须设置 DEV_USER_USERNAME 和 DEV_USER_PASSWORD')

const config = createConfig()
const localDataDirectory = fileURLToPath(new URL('../../data/', import.meta.url))
const relativeDataPath = path.relative(localDataDirectory, config.dataFile)
if (relativeDataPath.startsWith('..') || path.isAbsolute(relativeDataPath)) {
  throw new Error('拒绝执行：本地演示用户只能写入 server/data 目录下的开发数据库')
}

const database = await new JsonDatabase(config.dataFile).init()
const accounts = new AccountService(database, config)
const account = await accounts.createDevelopmentUser({
  username,
  password,
  name: process.env.DEV_USER_NAME || username,
  department: process.env.DEV_USER_DEPARTMENT || '本地演示环境'
}, { actor: 'local-development-cli' })

process.stdout.write(`${JSON.stringify({
  environment: config.env,
  dataFile: config.dataFile,
  username: account.username,
  accountId: account.id,
  localDevelopmentOnly: account.localDevelopmentOnly,
  schoolIdentityVerified: account.schoolIdentityVerified,
  loginEndpoint: '/api/v1/auth/login'
}, null, 2)}\n`)
