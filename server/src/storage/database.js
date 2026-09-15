import { JsonDatabase } from './json-database.js'
import { MySqlDatabase } from './mysql-database.js'

// An explicit MySQL configuration never silently falls back to archived JSON.
export async function openDatabase(config, { namespace = 'application', file = config.dataFile } = {}) {
  const driver = config.databaseDriver || 'json'
  if (driver === 'mysql') return new MySqlDatabase({ ...config.mysql, namespace }).init()
  if (driver !== 'json') throw new Error('Unsupported database driver')
  return new JsonDatabase(file).init()
}
