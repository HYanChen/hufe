import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const [mode = 'dev', platform = 'h5', ...extraArgs] = process.argv.slice(2)
if (!['dev', 'build'].includes(mode)) {
  console.error(`未知模式：${mode}，仅支持 dev 或 build`)
  process.exit(1)
}

const root = process.cwd()
const executable = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'uni.cmd' : 'uni')
const args = []
if (mode === 'build') args.push('build')
if (platform !== 'h5') args.push('-p', platform)
args.push(...extraArgs)

const result = spawnSync(executable, args, {
  cwd: root,
  env: {
    ...process.env,
    UNI_INPUT_DIR: root
  },
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 0)
