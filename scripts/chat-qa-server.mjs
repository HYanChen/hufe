// Loopback-only acceptance fixture. All records live in a disposable directory.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { createConfig } from '../server/src/config.js'
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-chat-browser-qa-'))
const status={stale:false,itemCount:0,sourceStatuses:[]}
const app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),mediaDir:path.join(dir,'media'),dataHashSecret:'isolated-chat-browser-qa',corsOrigins:['http://127.0.0.1:4273','http://127.0.0.1:5273','http://localhost:5273']}),logger:false,refreshContent:false,scheduleContent:false,contentService:{init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>status,home:()=>({status,sections:{}}),list:()=>({items:[],total:0,status}),get:async()=>null}})
const users={}
for(const [username,name]of [['qa_admin','验收管理员'],['qa_member','验收校友'],['qa_friend','验收同学']])users[username]=await app.services.accounts.register({schoolSubject:'chat-browser-'+username,name,personType:'alumni',department:'信息技术与管理学院',isAdmin:username==='qa_admin',verificationSource:'school-registration-check'},{username,password:'Isolated-QA-2026!'})
const chat=app.services.chat,c=await chat.create(users.qa_member.id,{type:'direct',memberIds:[users.qa_friend.id]})
const g=await chat.create(users.qa_member.id,{type:'group',title:'校友相聚 · 隔离验收群',memberIds:[users.qa_friend.id]})
for(let i=1;i<=35;i++)await chat.send(users.qa_member.id,g.id,{kind:'text',text:`第${i}条验收消息：用于验证历史消息分页。`,clientMessageId:'qa-'+i})
const token=app.services.sessions.issueAccess(users.qa_member).accessToken
await app.inject({method:'POST',url:'/api/v1/chat/conversations/'+c.id+'/messages',headers:{authorization:'Bearer '+token},payload:{kind:'text',text:'这是一条用于后台管控验收的私聊消息。',clientMessageId:'qa-text'}})
const bytes=await fs.readFile(new URL('../static/tabbar/home-active.png',import.meta.url)),u=await chat.startUpload(users.qa_member.id,c.id,{name:'验收聊天图片.png',size:bytes.length})
await chat.putChunk(users.qa_member.id,u.id,0,bytes);await chat.complete(users.qa_member.id,u.id);await chat.send(users.qa_member.id,c.id,{kind:'image',attachmentId:u.id,clientMessageId:'qa-image'})
const s=await chat.saveSticker(users.qa_admin.id,{name:'湖财问候',category:'验收表情',sortOrder:1,status:'active',dataBase64:bytes.toString('base64')})
await chat.send(users.qa_friend.id,c.id,{kind:'sticker',stickerId:s.id,clientMessageId:'qa-sticker'})
await chat.saveSticker(users.qa_admin.id,{name:'湖财问候',category:'验收表情',sortOrder:1,status:'hidden'},s.id)
await app.listen({host:'127.0.0.1',port:8879})
console.log(JSON.stringify({qa:'ready',directId:c.id,groupId:g.id}))
let closing=false
async function close(){if(closing)return;closing=true;await app.close();await fs.rm(dir,{recursive:true,force:true});process.exit(0)}
process.on('SIGINT',close);process.on('SIGTERM',close)
