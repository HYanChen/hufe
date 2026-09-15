import { mergeBundledRegions } from '../regions/upgrade.js'

const args = process.argv.slice(2)
const index = args.indexOf('--data-file')
const apply = args.includes('--apply')
if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
  throw new Error('用法：node src/cli/merge-region-seed.js --data-file /绝对路径/application-data.json [--apply --service-stopped]')
}
if (apply && !args.includes('--service-stopped')) throw new Error('应用更新前须停止 API，并明确传入 --service-stopped，避免覆盖运行中数据')
console.log(JSON.stringify(await mergeBundledRegions({ dataFile: args[index + 1], apply }), null, 2))
