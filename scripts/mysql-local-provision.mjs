import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const dir = path.join(root, '.local-runtime/mysql')
await fs.mkdir(dir, { recursive: true, mode: 0o700 })
const appPassword = randomBytes(32).toString('base64url')
const rootPassword = randomBytes(32).toString('base64url')
const config = { host: '127.0.0.1', port: 13306, user: 'hufe_local', password: appPassword, database: 'hufe_local' }
await fs.writeFile(path.join(dir, 'application.json'), JSON.stringify(config), { mode: 0o600, flag: 'wx' })
await fs.writeFile(path.join(dir, 'application.env'), `DATABASE_DRIVER=mysql\nMYSQL_HOST=127.0.0.1\nMYSQL_PORT=13306\nMYSQL_DATABASE=hufe_local\nMYSQL_USER=hufe_local\nMYSQL_PASSWORD=${appPassword}\n`, { mode: 0o600, flag: 'wx' })
await fs.writeFile(path.join(dir, 'container.env'), `MYSQL_ROOT_PASSWORD=${rootPassword}\nMYSQL_DATABASE=hufe_local\nMYSQL_USER=hufe_local\nMYSQL_PASSWORD=${appPassword}\n`, { mode: 0o600, flag: 'wx' })
await fs.writeFile(path.join(dir, 'root.cnf'), `[client]\nuser=root\npassword=${rootPassword}\n`, { mode: 0o600, flag: 'wx' })
execFileSync('docker', ['run','-d','--name','hufe-mysql-local','--restart','unless-stopped','--memory','768m','-p','127.0.0.1:13306:3306','--env-file',path.join(dir,'container.env'),'-v','hufe-mysql-local-data:/var/lib/mysql','-v',`${path.join(dir,'root.cnf')}:/run/secrets/client.cnf:ro`,'mysql:8.4','--innodb-buffer-pool-size=128M'], { stdio: 'ignore' })
console.log('Local MySQL container created at 127.0.0.1:13306. Credentials saved in private runtime files, not printed.')
