import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import verifier from './verify-production-handoff.cjs'
import releaseTools from './baota-release.cjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
// This packager is pinned to the reviewed public runtime, not a generic build.
const release='20260916-public-sanitized'
const expectedRuntimeSha='70e1564156ceb6758db33f14de50f90007f19682469a9fc970a32d37579e9694'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export function allowedSourcePath(relative) {
  const parts=relative.split('/')
  if(parts.some(p=>['.git','.local-runtime','node_modules','dist','unpackage','outputs','tmp','.DS_Store'].includes(p)))return false
  if(parts.some(p=>/ \d+\.[^/]+$/.test(p)))return false
  if(parts.some(p=>p.startsWith('.env')&&!p.endsWith('.example')))return false
  if(/\.(?:log|jsonl|sql|zip|tar|gz|bak)$/.test(relative))return false
  return true
}
export async function copySource(from,to) {
  const stat=await fs.lstat(from)
  if(stat.isSymbolicLink())throw Error(`Source symlink refused: ${from}`)
  if(stat.isDirectory()){
    await fs.mkdir(to,{recursive:true,mode:0o755})
    for(const name of await fs.readdir(from))if(allowedSourcePath(name))await copySource(path.join(from,name),path.join(to,name))
  } else if(stat.isFile()){
    await fs.mkdir(path.dirname(to),{recursive:true,mode:0o755})
    await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL)
    await fs.chmod(to,0o644)
  } else throw Error('Unsupported source file type')
}

const sourceReadme=`# 湖财人完整源码交付

本目录包含客户端、管理后台、后端、公共地图与区域数据、品牌原稿、构建脚本及回归测试源码。部署人员优先阅读包根目录的 deployment/正式环境部署说明.md；可直接使用 runtime/ 中已经验收的网页成品，无需在服务器重新构建前端。

## 运行与重新构建

- Node.js 22、与根 pnpm-lock.yaml 匹配的 pnpm 版本及 workspace 安装；首次重新构建需要访问包仓库。未捆绑前端开发 node_modules、Docker 镜像、Node/MySQL 安装器，此包不是完全断网安装介质。
- 在独立开发目录安装：pnpm install --frozen-lockfile。禁止在正在运行的生产目录安装或升级依赖。workspace 中的根锁文件为本次配套依据，不使用旧独立 admin 锁文件。
- H5同源生产构建：VITE_API_BASE_URL='' node scripts/run-uni.mjs build h5。
- 后台构建：在 admin 目录执行 node node_modules/vite/bin/vite.js build；前后台产物各在 dist/build/h5 和 admin/dist。
- 结构检查：node scripts/validate-project.mjs。后端测试：node --test server/test/*.test.js；前端测试：node --test test/*.test.mjs；后台测试：node --test admin/test/*.test.js admin/test/*.test.mjs。
- 真实 MySQL、Docker 或浏览器集成测试必须按脚本明确参数在独立测试环境执行；无参数时的跳过不等于真实集成测试通过。测试夹具中的示例口令不是正式账号，不得用其初始化生产。

## 数据与边界

本版本使用 MySQL 六命名空间适配层，不执行历史 PostgreSQL 建表设计。旧 server/db SQL 和过时部署说明没有装入本交付源码。实际业务数据、私有上传材料、聊天文件、数据库密码及 DATA_HASH_SECRET 必须按另行交接清单受控迁移。

server/data/ 只含公共 IP 归属数据库；server/src/maps/ 含长沙内置地图、渲染资产与许可；server/src/regions/ 含行政区域和城市中心公共数据。其余 server/data 内容均不包含。

scripts/ 内保留完整构建与测试依赖，但历史 baota / mysql-baota 专站脚本不是通用安装命令，QA / create-dev 脚本不是生产账号初始化方案。包内成品与当前已上线版本一致，原生 App/小程序需另行构建及真机验收。
`

export async function packageHandoff({base=root,stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')}={}){
  if(!/^\d{8}T\d{6}Z$/.test(stamp))throw Error('Invalid handoff stamp')
  const runtimeName=`hufe-${release}.tar.gz`, runtime=path.join(base,'.local-runtime',runtimeName)
  if(sha(await fs.readFile(runtime))!==expectedRuntimeSha)throw Error('Verified runtime archive changed')
  releaseTools.verifyRelease(path.join(base,'.local-runtime',release),release)
  const stage=path.join(base,'.local-runtime',`handoff-${stamp}`)
  await fs.mkdir(stage,{mode:0o700})
  const source=path.join(stage,'source')
  const roots=['App.vue','main.js','index.html','jsconfig.json','manifest.json','pages.json','uni.scss','vite.config.js','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.env.example','.env.production.example','.gitignore','components','config','custom-tab-bar','pages','services','shared','static','utils','assets/brand-sources','scripts','test','deploy/handoff','server/src','server/test','server/package.json','server/.env.example','server/third-party','admin/src','admin/public','admin/test','admin/package.json','admin/vite.config.js','admin/index.html']
  for(const relative of roots)await copySource(path.join(base,relative),path.join(source,relative))
  for(const name of ['ip2region_v4.xdb','ip2region_v6.xdb','manifest.json'])await copySource(path.join(base,'server/data/ip-region',name),path.join(source,'server/data/ip-region',name))
  await copySource(path.join(base,'README.md'),path.join(source,'README.md'))
  for(const name of ['.gitattributes','.github','CHANGELOG.md','CONTRIBUTING.md','NOTICE.md','SECURITY.md'])await copySource(path.join(base,name),path.join(source,name))
  const docs=(await fs.readdir(path.join(base,'docs'))).filter(name=>name.endsWith('.md'))
  for(const name of docs)await copySource(path.join(base,'docs',name),path.join(source,'docs',name))
  await copySource(path.join(base,'deploy/handoff/交付总入口.md'),path.join(stage,'README.md'))
  for(const name of await fs.readdir(path.join(base,'deploy/handoff')))if(name!=='交付总入口.md')await copySource(path.join(base,'deploy/handoff',name),path.join(stage,'deployment',name))
  await copySource(path.join(base,'scripts/verify-production-handoff.cjs'),path.join(stage,'verify-handoff.cjs'))
  await fs.mkdir(path.join(stage,'runtime'),{mode:0o755})
  await fs.copyFile(runtime,path.join(stage,'runtime',runtimeName),fs.constants.COPYFILE_EXCL)
  await fs.writeFile(path.join(stage,'runtime',runtimeName+'.sha256'),`${expectedRuntimeSha}  ${runtimeName}\n`,{flag:'wx',mode:0o644})
  const files=verifier.inventory(stage)
  await fs.writeFile(path.join(stage,'handoff-manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),release,runtimeSha256:expectedRuntimeSha,scope:'source-and-verified-web-runtime-no-business-data-or-live-secrets',files},null,2)+'\n',{flag:'wx',mode:0o644})
  verifier.verify(stage)
  const out=path.join(base,'交付文档');await fs.mkdir(out,{recursive:true})
  const archive=path.join(out,`湖财人-正式部署完整版-${stamp}.zip`)
  await fs.writeFile(archive,Buffer.alloc(0),{flag:'wx',mode:0o600})
  // zip cannot update an empty placeholder; feed its path only after proving it
  // was reserved by this process, without ever touching an existing archive.
  await fs.unlink(archive)
  execFileSync('zip',['-q','-r','-X',archive,'.'],{cwd:stage,env:{...process.env,COPYFILE_DISABLE:'1'}})
  const bytes=(await fs.stat(archive)).size,sha256=sha(await fs.readFile(archive))
  await fs.writeFile(archive+'.sha256',`${sha256}  ${path.basename(archive)}\n`,{flag:'wx',mode:0o644})
  return {archive,checksumFile:archive+'.sha256',stage,release,files:files.length,bytes,sha256}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageHandoff(),null,2))
