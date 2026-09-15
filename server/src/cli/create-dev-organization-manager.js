import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfig } from '../config.js'
import { JsonDatabase } from '../storage/json-database.js'
import { AccountService } from '../accounts/service.js'
import { BusinessService } from '../business/service.js'
import { DelegationService } from '../admin/delegation-service.js'

if (String(process.env.DATABASE_DRIVER || '').toLowerCase() === 'mysql') throw new Error('MySQL 模式不支持旧版 JSON 演示账号工具，请通过后台账号管理添加人员，禁止写入迁移前的数据文件')

const confirmation = 'create-local-development-organization-manager'
if (process.env.DEV_ORG_MANAGER_BOOTSTRAP !== confirmation) throw new Error(`拒绝执行：请显式设置 DEV_ORG_MANAGER_BOOTSTRAP=${confirmation}`)
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('拒绝执行：NODE_ENV 必须为 development')

const config = createConfig({ env: 'development' })
const localDataDirectory = fileURLToPath(new URL('../../data/', import.meta.url))
const relativeDataPath = path.relative(localDataDirectory, config.dataFile)
if (relativeDataPath.startsWith('..') || path.isAbsolute(relativeDataPath)) throw new Error('拒绝执行：本地演示账号只能写入 server/data 目录下的开发数据库')

const database = await new JsonDatabase(config.dataFile).init()
const accounts = new AccountService(database, config)
const business = new BusinessService(database, config)
await business.init()
const delegations = new DelegationService(database)
const organization = database.read((data) => data.business?.resources?.organizations?.[0])
if (!organization) throw new Error('开发数据库没有可委派的 seed organization')

const username = String(process.env.DEV_ORG_MANAGER_USERNAME || 'hufe_org_manager').trim()
const password = process.env.DEV_ORG_MANAGER_PASSWORD || crypto.randomBytes(18).toString('base64url')
const account = await accounts.provisionOperator({
  username, temporaryPassword: password, displayName: process.env.DEV_ORG_MANAGER_NAME || '校友组织运营员',
  department: process.env.DEV_ORG_MANAGER_DEPARTMENT || '校友工作办公室', accountType: 'operations'
}, { actor: 'local-development-cli' })
await delegations.create({ id: 'local-development-cli', isAdmin: true }, {
  accountId: account.id, resource: 'organizations', resourceId: organization.id,
  permissions: ['read', 'update', 'moderate', 'manage_members']
}, { actor: 'local-development-cli' })

process.stdout.write(`${JSON.stringify({
  environment: config.env, dataFile: config.dataFile, username: account.username, temporaryPassword: password,
  accountId: account.id, accountSource: account.accountSource, schoolIdentityVerified: account.schoolIdentityVerified,
  isAdmin: account.isAdmin, mustChangePassword: account.mustChangePassword,
  scope: { resource: 'organizations', resourceId: organization.id, name: organization.name }
}, null, 2)}\n`)
