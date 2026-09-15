// Isolated loopback clients for the disposable Gate acceptance API on 8879.
// Never stop or reconfigure the normal 5173 / 4180 / 8787 services.
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'.local-runtime/gate-qa'),stateFile=path.join(dir,'clients.json'),node=process.execPath
const definitions=[{name:'frontend',port:5273,cwd:root,entry:path.join(root,'scripts/run-uni.mjs'),args:['dev','h5','--host','127.0.0.1','--port','5273','--strictPort'],env:{VITE_API_BASE_URL:'http://127.0.0.1:8879',UNI_OUTPUT_DIR:path.join(dir,'h5')}},{name:'admin',port:4273,cwd:path.join(root,'admin'),entry:path.join(root,'admin/node_modules/vite/bin/vite.js'),args:['--host','127.0.0.1','--port','4273','--strictPort'],env:{VITE_API_BASE_URL:'/api/v1',HUFE_API_PROXY:'http://127.0.0.1:8879'}}]
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const owned=record=>{if(!record?.pid||!record?.entry?.startsWith(root+'/'))return false;try{return execFileSync('ps',['-p',String(record.pid),'-o','command='],{encoding:'utf8'}).includes(record.entry)}catch{return false}}
const occupied=port=>new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));socket.setTimeout(1200,()=>{socket.destroy();resolve(false)})})
await fs.mkdir(dir,{recursive:true,mode:0o700})
let records={};try{records=JSON.parse(await fs.readFile(stateFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
if(process.argv[2]==='stop'){
  for(const record of Object.values(records))if(owned(record))process.kill(-record.pid,'SIGTERM')
  await fs.writeFile(stateFile,'{}\n',{mode:0o600});console.log('已停止隔离核验前后台，普通本地服务未变。')
}else{
  for(const def of definitions){if(owned(records[def.name])){console.log(`${def.name} 已在运行 PID ${records[def.name].pid}`);continue}if(await occupied(def.port))throw Error(`${def.port} 已被占用，未停止或复用未知进程`)
    const log=await fs.open(path.join(dir,def.name+'.log'),'a',0o600),child=spawn(node,[def.entry,...def.args],{cwd:def.cwd,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,NODE_ENV:'development',PATH:path.dirname(node)+':'+process.env.PATH,...def.env}})
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await log.close();records[def.name]={pid:child.pid,entry:def.entry,port:def.port};await fs.writeFile(stateFile,JSON.stringify(records,null,2)+'\n',{mode:0o600})
    let ready=false;for(let attempt=0;attempt<60;attempt++){try{ready=(await fetch(`http://127.0.0.1:${def.port}`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;if(!owned(records[def.name]))break;await sleep(500)}
    if(!ready)throw Error(`${def.name} 未就绪，请检查 ${path.join(dir,def.name+'.log')}`);console.log(`${def.name} 就绪 PID ${child.pid} http://127.0.0.1:${def.port}`)
  }
}
