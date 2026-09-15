import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { openDatabase } from '../storage/database.js'
import {prepareImage,writePreparedImage} from '../media/service.js'
import {uploadedImage,MAX_PHOTO_BYTES} from '../media/transfers.js'
import { schoolGroupProfiles, schoolGroupFingerprint, reconcileSchoolGroups, groupPermissions, canUseSchoolGroup } from './school-groups.js'

export const CHUNK_SIZE = 4 * 1024 * 1024
export const MAX_FILE_SIZE = 5 * 1024 ** 3
const DAY = 86400000
const err = (message, code = 'CHAT_INVALID', statusCode = 400) => Object.assign(new Error(message), {code,statusCode})
const text = (value,max,required=false) => { if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||required&&!value.trim())throw err('内容为空或超过长度限制');return value.trim() }
const idPattern = /^[a-f0-9-]{36}$/i
const hash = value => createHash('sha256').update(value).digest('hex')
const safePerson = a => ({ id:a.id,name:a.name,department:a.department || '',personType:a.personType })
function arrays(d){for(const k of ['conversations','messages','uploads','stickers'])d[k] ||= [];return d}
export function imageMime(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))return 'image/gif';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';return ''}
export class ChatService {
  constructor(accounts,config){this.accounts=accounts;this.config=config;this.dir=path.join(path.dirname(config.dataFile),'chat');this.chunkSize=config.chatChunkSize || CHUNK_SIZE;this.maxFileSize=config.chatMaxFileSize || MAX_FILE_SIZE;this.quota=config.chatStorageLimit || 20*1024**3;this.locks=new Map();this.tickets=new Map()}
  async init(){
    await fs.mkdir(this.dir,{recursive:true,mode:0o700})
    this.db=await openDatabase(this.config,{namespace:'chat',file:path.join(this.dir,'index.json')})
    try{await this.db.transaction(d=>{arrays(d)});await this.syncSchoolGroups();await this.cleanup();this.timer=setInterval(()=>this.cleanup().catch(()=>{}),3600000);this.timer.unref();return this}
    catch(error){await this.db.close?.();throw error}
  }
  async close(){clearInterval(this.timer);await Promise.allSettled([...this.locks.values()]);await this.db.queue;await this.db.close?.()}
  account(id){const a=this.accounts.read(d=>d.accounts.find(a=>a.id===id&&a.status==='active'));if(!a)throw err('请重新登录','ACCOUNT_INACTIVE',401);if(a.mustChangePassword)throw err('首次登录必须先修改临时密码','PASSWORD_CHANGE_REQUIRED',403);if(!a.schoolIdentityVerified && !(this.config.env==='development'&&a.localDevelopmentOnly))throw err('完成实名认证后才能使用对话','CHAT_VERIFICATION_REQUIRED',403);return a}
  admin(id){const a=this.accounts.read(d=>d.accounts.find(a=>a.id===id&&a.status==='active'&&a.isAdmin&&a.adminRole!=='delegated_admin'&&!a.mustChangePassword));if(!a)throw err('仅全局管理员可以管理对话','ADMIN_REQUIRED',403);return a}
  member(d,id,cid){const account=this.account(id);const c=d.conversations.find(c=>c.id===cid&&c.members.some(m=>m.id===id));if(!c||!canUseSchoolGroup(account,c))throw err('对话不存在或你已不在此对话中','CHAT_FORBIDDEN',403);return c}
  async syncSchoolGroups(){
    const profiles=this.accounts.read(d=>schoolGroupProfiles(d.accounts)),fingerprint=schoolGroupFingerprint(profiles)
    if(fingerprint===this.schoolSyncFingerprint)return
    return this.locked('school-groups',async()=>{
      if(fingerprint===this.schoolSyncFingerprint)return
      await this.db.transaction(d=>{
        const result=reconcileSchoolGroups(d,profiles)
        if(Object.values(result).some(Boolean))(d.chatGroupEvents||=[]).push({id:randomUUID(),action:'school_groups_synced',actorId:'system',...result,createdAt:new Date().toISOString()})
      })
      this.schoolSyncFingerprint=fingerprint
    })
  }
  writable(c){if(c.status==='dissolved'||c.dissolvedAt)throw err('此群聊已解散，仅保留历史记录','CHAT_DISSOLVED',403);if(c.status==='paused')throw err('此会话已被管理员停用，暂不能发送消息或管理成员','CHAT_PAUSED',403);return c}
  locked(id,work){const p=(this.locks.get(id)||Promise.resolve()).then(work,work);this.locks.set(id,p);return p.finally(()=>{if(this.locks.get(id)===p)this.locks.delete(id)})}
  view(c,id,d){const people=this.accounts.read(s=>s.accounts);const other=people.find(a=>a.id===c.members.find(m=>m.id!==id)?.id);const mine=c.members.find(m=>m.id===id);const last=d.messages.filter(m=>m.conversationId===c.id&&m.seq>=mine.joinedSeq).at(-1);return {id:c.id,type:c.type,title:c.type==='group'?c.title:other?.name||'对方账号',ownerId:c.ownerId,schoolGroup:c.schoolGroup||null,groupRevision:c.groupRevision||0,permissions:groupPermissions(c,id),status:c.status||'active',moderationRevision:c.moderationRevision||0,members:c.members.map(m=>({...safePerson(people.find(a=>a.id===m.id)||{id:m.id,name:'已停用账号'}),role:m.id===c.ownerId?'owner':m.role==='admin'?'admin':'member'})),unread:d.messages.filter(m=>m.conversationId===c.id&&m.seq>mine.lastReadSeq&&m.seq>=mine.joinedSeq&&m.senderId!==id).length,lastMessage:last?{kind:last.kind,text:last.status==='hidden'?'[消息已被管理员隐藏]':last.kind==='text'?last.text.slice(0,80):({file:'[文件]',image:'[图片]',sticker:'[表情包]',system:'[群通知]'})[last.kind],createdAt:last.createdAt}:null,updatedAt:c.updatedAt}}
  people(id,query){this.account(id);const q=text(String(query||''),80);if(!q)return [];return this.accounts.read(d=>d.accounts.filter(a=>a.id!==id&&a.status==='active'&&a.schoolIdentityVerified&&[a.name,a.username].some(v=>String(v).toLowerCase().includes(q.toLowerCase()))).slice(0,30).map(safePerson))}
  list(id){const account=this.account(id);return this.db.read(d=>({items:d.conversations.filter(c=>c.members.some(m=>m.id===id)&&canUseSchoolGroup(account,c)).map(c=>this.view(c,id,d)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}))}
  conversation(id,cid){return this.db.read(d=>this.view(this.member(d,id,cid),id,d))}
  async create(id,input){this.account(id);const type=input.type;if(!['direct','group'].includes(type))throw err('请选择私聊或群聊');const target=Array.isArray(input.memberIds)?[...new Set(input.memberIds)]:[];if(target.some(x=>typeof x!=='string')||target.includes(id)||target.length<1||target.length>99||type==='direct'&&target.length!==1)throw err('请选择有效的对话成员，群聊最多100人');target.forEach(x=>this.account(x));const title=type==='group'?text(input.title,60,true):'';return this.db.transaction(d=>{this.account(id);target.forEach(x=>this.account(x));if(type==='direct'){const found=d.conversations.find(c=>c.type==='direct'&&c.members.length===2&&c.members.some(m=>m.id===id)&&c.members.some(m=>m.id===target[0]));if(found)return this.view(found,id,d)}if(d.conversations.filter(c=>c.members.some(m=>m.id===id)).length>=200)throw err('对话数量已达200个上限');const now=new Date().toISOString(),c={id:randomUUID(),type,title,ownerId:id,members:[id,...target].map(id=>({id,lastReadSeq:0,joinedSeq:1})),seq:0,createdAt:now,updatedAt:now};d.conversations.push(c);return this.view(c,id,d)})}
  messages(id,cid,query={}){return this.db.read(d=>{const c=this.member(d,id,cid),member=c.members.find(m=>m.id===id);const reset=query.revision!==undefined&&Number(query.revision)!==(c.moderationRevision||0);const before=reset?Infinity:Number(query.before)||Infinity,after=reset?0:Number(query.after)||0;const eligible=d.messages.filter(m=>m.conversationId===cid&&m.seq>=member.joinedSeq&&m.seq<before&&m.seq>after);const rows=after?eligible.slice(0,50):eligible.slice(-50);return {items:rows.map(m=>this.messageView(d,m,id)),hasMore:eligible.length>rows.length,lastSeq:c.seq,reset,revision:c.moderationRevision||0,groupRevision:c.groupRevision||0,status:c.status||'active'}})}
  messageView(d,m,id,admin=false){if(m.status==='hidden'&&!admin)return {id:m.id,seq:m.seq,senderId:m.senderId,senderName:this.accounts.read(s=>s.accounts.find(a=>a.id===m.senderId)?.name)||'湖财人',mine:m.senderId===id,kind:'text',text:'消息已被管理员隐藏',createdAt:m.createdAt,status:'hidden',attachment:null,sticker:null};const a=this.accounts.read(s=>s.accounts.find(a=>a.id===m.senderId));const u=d.uploads.find(u=>u.id===m.attachmentId);const s=d.stickers.find(s=>s.id===m.stickerId&&(admin||s.status==='active'));return {id:m.id,seq:m.seq,senderId:m.senderId,senderName:a?.name||'湖财人',mine:m.senderId===id,kind:m.kind,text:m.text,createdAt:m.createdAt,attachment:u?{id:u.id,name:u.name,size:u.size,mimeType:u.mimeType}:null,sticker:m.kind==='sticker'?(s?this.stickerView(s):{id:m.stickerId,name:'表情已下架',url:''}):null}}
  async send(id,cid,input,trace=null){const kind=input.kind;if(!['text','image','file','sticker'].includes(kind))throw err('不支持的消息类型');const clientId=text(input.clientMessageId,80,true);const content=kind==='text'?text(input.text,4000,true):'';return this.db.transaction(d=>{const c=this.writable(this.member(d,id,cid));const previous=d.messages.find(m=>m.conversationId===cid&&m.senderId===id&&m.clientMessageId===clientId);if(previous){if(previous.kind!==kind||previous.text!==content||previous.attachmentId!==(input.attachmentId||'')||previous.stickerId!==(input.stickerId||''))throw err('重试消息内容不一致','CHAT_MESSAGE_CONFLICT',409);return this.messageView(d,previous,id)}let u;if(['image','file'].includes(kind)){u=d.uploads.find(u=>u.id===input.attachmentId&&u.ownerId===id&&u.conversationId===cid&&u.status==='ready'&&u.expiresAt>Date.now());if(!u)throw err('文件未上传完成或不属于当前对话');if(kind==='image'&&!u.mimeType.startsWith('image/'))throw err('该附件不是有效图片')}if(kind==='sticker'&&!d.stickers.some(s=>s.id===input.stickerId&&s.status==='active'))throw err('表情已下架，请重新选择');const m={id:randomUUID(),conversationId:cid,senderId:id,clientMessageId:clientId,trace:trace?structuredClone(trace):null,seq:++c.seq,kind,text:content,attachmentId:u?.id||'',stickerId:kind==='sticker'?input.stickerId:'',createdAt:new Date().toISOString()};d.messages.push(m);if(u){u.status='bound';u.messageId=m.id}c.updatedAt=m.createdAt;return this.messageView(d,m,id)})}
  async read(id,cid,seq){return this.db.transaction(d=>{const c=this.member(d,id,cid),m=c.members.find(m=>m.id===id);if(!Number.isSafeInteger(seq)||seq<0||seq>c.seq)throw err('已读位置无效');m.lastReadSeq=Math.max(m.lastReadSeq,seq);return {readSeq:m.lastReadSeq}})}
  async group(id,cid,input,trace=null){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['title','addIds','removeId','adminId','role','revision'].includes(k)))throw err('包含不支持的群管理字段')
    return this.db.transaction(d=>{
      const c=this.writable(this.member(d,id,cid)),permissions=groupPermissions(c,id)
      if(c.type!=='group')throw err('私聊不支持群管理')
      if(!permissions.manageMembers)throw err('仅群主或群管理员可管理群聊','CHAT_OWNER_REQUIRED',403)
      if(input.revision!==undefined&&input.revision!==(c.groupRevision||0))throw err('群成员已变化，请刷新后重试','CHAT_GROUP_CONFLICT',409)
      if(input.adminId!==undefined){
        if(!permissions.manageAdmins)throw err('仅群主可设置或撤销管理员','CHAT_OWNER_REQUIRED',403)
        if(!Number.isSafeInteger(input.revision)||!['admin','member'].includes(input.role))throw err('请选择成员角色并刷新当前群版本')
        const member=c.members.find(m=>m.id===input.adminId)
        if(!member||member.id===c.ownerId)throw err('请选择群主以外的当前成员')
        this.account(member.id);member.role=input.role
      }else if(input.role!==undefined)throw err('请指定要设置的群成员')
      if(input.title!==undefined){if(!permissions.rename)throw err('学籍群名称由认证资料自动生成');c.title=text(input.title,60,true)}
      if(input.addIds!==undefined){
        if(!permissions.addMembers)throw err('学籍群成员按认证资料自动关联，不支持手动邀请')
        if(!Array.isArray(input.addIds)||input.addIds.length>99||input.addIds.some(x=>typeof x!=='string'))throw err('成员数量无效')
        for(const other of [...new Set(input.addIds)]){this.account(other);if(!c.members.some(m=>m.id===other))c.members.push({id:other,role:'member',lastReadSeq:c.seq,joinedSeq:c.seq+1})}
      }
      if(input.removeId!==undefined){
        if(c.schoolGroup)throw err('固定学籍群成员由认证资料维护，不能手动移出','CHAT_SCHOOL_GROUP_FIXED',403)
        const member=c.members.find(m=>m.id===input.removeId)
        if(!member)throw err('该成员已不在群中')
        if(member.id===id||member.id===c.ownerId)throw err('不能移除自己或群主')
        if(c.ownerId!==id&&member.role==='admin')throw err('群管理员不能移除其他管理员','CHAT_OWNER_REQUIRED',403)
        c.members=c.members.filter(m=>m.id!==member.id)
      }
      if(!c.schoolGroup&&c.members.length>100)throw err('群聊最多100人')
      c.groupRevision=(c.groupRevision||0)+1;c.updatedAt=new Date().toISOString()
      ;(d.chatGroupEvents||=[]).push({id:randomUUID(),conversationId:cid,actorId:id,action:input.adminId?'administrator_changed':'members_changed',targetId:input.adminId||input.removeId||'',role:input.role||'',createdAt:c.updatedAt,trace:trace?structuredClone(trace):null})
      return this.view(c,id,d)
    })
  }
  async assignOwner(id,cid,input,trace=null){
    this.admin(id)
    if(!input||Object.keys(input).some(k=>!['ownerId','revision'].includes(k))||typeof input.ownerId!=='string'||!Number.isSafeInteger(input.revision))throw err('请选择群主并刷新群版本')
    return this.db.transaction(d=>{
      this.admin(id);const c=d.conversations.find(c=>c.id===cid&&c.type==='group')
      if(!c)throw err('群聊不存在','CHAT_NOT_FOUND',404)
      if(c.status==='dissolved'||c.dissolvedAt)throw err('已解散群聊不能再设置群主','CHAT_DISSOLVED',403)
      if(input.revision!==(c.groupRevision||0))throw err('群成员已变化，请刷新后重试','CHAT_GROUP_CONFLICT',409)
      const person=this.account(input.ownerId),member=c.members.find(m=>m.id===person.id)
      if(!person.schoolIdentityVerified||!member||!canUseSchoolGroup(person,c))throw err('群主必须是当前群内的有效实名成员')
      const previous=c.ownerId;c.ownerId=member.id;member.role='member';c.groupRevision=(c.groupRevision||0)+1;c.updatedAt=new Date().toISOString()
      const old=c.members.find(m=>m.id===previous);if(old&&old.id!==member.id)old.role='member'
      ;(d.chatGroupEvents||=[]).push({id:randomUUID(),conversationId:cid,actorId:id,action:'owner_assigned',previous,ownerId:member.id,createdAt:c.updatedAt,trace:trace?structuredClone(trace):null})
      return {ownerId:c.ownerId,groupRevision:c.groupRevision}
    })
  }
  async leave(id,cid,trace=null){return this.db.transaction(d=>{const c=this.member(d,id,cid);if(c.type!=='group')throw err('只能退出群聊');if(c.schoolGroup)throw err('固定学籍群不能退出，成员关系随认证学籍维护','CHAT_SCHOOL_GROUP_FIXED',403);if(c.ownerId===id&&c.status!=='dissolved'&&!c.dissolvedAt)throw err('群主请先解散群聊或由后台转交群主再退出','CHAT_OWNER_CANNOT_LEAVE',403);c.members=c.members.filter(m=>m.id!==id);if(c.ownerId===id)c.ownerId='';c.groupRevision=(c.groupRevision||0)+1;c.updatedAt=new Date().toISOString();(d.chatGroupEvents||=[]).push({id:randomUUID(),conversationId:cid,actorId:id,action:'member_left',createdAt:c.updatedAt,trace:trace?structuredClone(trace):null});return {left:true}})}
  async dissolve(id,cid,input,trace=null){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>k!=='revision')||!Number.isSafeInteger(input.revision)||input.revision<0)throw err('请刷新群版本后确认解散')
    return this.db.transaction(d=>{
      const c=this.member(d,id,cid)
      if(c.type!=='group'||c.schoolGroup)throw err('只有自行创建的群聊可以由群主解散','CHAT_SCHOOL_GROUP_FIXED',403)
      if(c.ownerId!==id)throw err('只有群主可以解散群聊','CHAT_OWNER_REQUIRED',403)
      if(c.status==='dissolved'||c.dissolvedAt)return {dissolved:true,conversation:this.view(c,id,d)}
      if(input.revision!==(c.groupRevision||0))throw err('群成员已变化，请刷新并重新确认','CHAT_GROUP_CONFLICT',409)
      const previous=c.status||'active',timestamp=new Date().toISOString()
      c.status='dissolved';c.dissolvedAt=timestamp;c.dissolvedBy=id;c.updatedAt=timestamp;c.groupRevision=(c.groupRevision||0)+1;c.moderationRevision=(c.moderationRevision||0)+1
      ;(d.chatGroupEvents||=[]).push({id:randomUUID(),conversationId:cid,actorId:id,action:'group_dissolved',previous,status:'dissolved',createdAt:timestamp,trace:trace?structuredClone(trace):null})
      return {dissolved:true,conversation:this.view(c,id,d)}
    })
  }
  uploadPath(id){if(!idPattern.test(id))throw err('文件编号无效');return path.join(this.dir,'files',id)}
  ownedUpload(id,uid){return this.db.read(d=>{const u=d.uploads.find(u=>u.id===uid&&u.ownerId===id);if(!u)throw err('上传任务不存在','CHAT_UPLOAD_NOT_FOUND',404);this.member(d,id,u.conversationId);return u})}
  async manifest(uid){return JSON.parse(await fs.readFile(path.join(this.uploadPath(uid),'manifest.json'),'utf8'))}
  async saveManifest(uid,value){const file=path.join(this.uploadPath(uid),'manifest.json');await fs.writeFile(file+'.next',JSON.stringify(value),{mode:0o600});await fs.rename(file+'.next',file)}
  async startUpload(id,cid,input){this.conversation(id,cid);const name=text(input.name,180,true).replace(/[\\/\r\n]/g,'_');const size=input.size;if(!Number.isSafeInteger(size)||size<1||size>this.maxFileSize)throw err('单个文件须大于0字节且不超过5GB','CHAT_FILE_TOO_LARGE',413);const uid=randomUUID();try{await fs.mkdir(this.uploadPath(uid),{recursive:true,mode:0o700});await this.saveManifest(uid,{parts:{}});return await this.db.transaction(d=>{this.writable(this.member(d,id,cid));const live=d.uploads.filter(u=>!['cancelled','expired'].includes(u.status));if(live.filter(u=>u.ownerId===id&&u.status==='uploading').length>=3)throw err('最多同时上传3个文件');if(live.reduce((n,u)=>n+u.size,0)+size>this.quota)throw err('聊天文件存储空间不足，请联系管理员','CHAT_STORAGE_FULL',507);const u={id:uid,ownerId:id,conversationId:cid,name,size,chunkSize:this.chunkSize,parts:Math.ceil(size/this.chunkSize),status:'uploading',mimeType:'application/octet-stream',createdAt:new Date().toISOString(),expiresAt:Date.now()+DAY};d.uploads.push(u);return {...u,received:[]}})}catch(e){await fs.rm(this.uploadPath(uid),{recursive:true,force:true});throw e}}
  async uploadStatus(id,uid){const u=this.ownedUpload(id,uid);if(['cancelled','expired'].includes(u.status))throw err('上传已取消或过期','CHAT_UPLOAD_EXPIRED',410);return {...u,received:(await this.manifest(uid)).parts}}
  async putChunk(id,uid,index,bytes){return this.locked(uid,async()=>{const u=this.ownedUpload(id,uid);this.writable(this.conversation(id,u.conversationId));if(u.status!=='uploading'||u.expiresAt<Date.now())throw err('上传已结束或过期','CHAT_UPLOAD_EXPIRED',410);if(!Number.isSafeInteger(index)||index<0||index>=u.parts)throw err('分片编号无效');const expected=Math.min(u.chunkSize,u.size-index*u.chunkSize);if(!Buffer.isBuffer(bytes)||bytes.length!==expected)throw err('分片长度不正确');const manifest=await this.manifest(uid),digest=hash(bytes);if(manifest.parts[index]){if(manifest.parts[index]!==digest)throw err('分片内容不一致，请重新选择原文件','CHAT_CHUNK_CONFLICT',409);return {index,sha256:digest}}const free=await fs.statfs(this.dir);if(free.bavail*free.bsize<bytes.length+64*1024*1024)throw err('服务器可用空间不足','CHAT_STORAGE_FULL',507);const file=path.join(this.uploadPath(uid),String(index));await fs.writeFile(file+'.next',bytes,{mode:0o600});await fs.rename(file+'.next',file);this.writable(this.conversation(id,u.conversationId));manifest.parts[index]=digest;await this.saveManifest(uid,manifest);return {index,sha256:digest}})}
  async complete(id,uid){return this.locked(uid,async()=>{const u=this.ownedUpload(id,uid);if(['ready','bound'].includes(u.status))return {id:u.id,status:u.status};if(u.status!=='uploading'||u.expiresAt<Date.now())throw err('上传已过期','CHAT_UPLOAD_EXPIRED',410);const m=await this.manifest(uid);for(let i=0;i<u.parts;i++){if(!m.parts[i])throw err('尚有分片未完成');const stat=await fs.stat(path.join(this.uploadPath(uid),String(i)));if(stat.size!==Math.min(u.chunkSize,u.size-i*u.chunkSize))throw err('分片文件不完整')}const handle=await fs.open(path.join(this.uploadPath(uid),'0'),'r');let first;try{first=Buffer.alloc(16);await handle.read(first,0,16,0)}finally{await handle.close()}const mime=u.size<=MAX_PHOTO_BYTES?imageMime(first):'';return this.db.transaction(d=>{this.writable(this.member(d,id,u.conversationId));const live=d.uploads.find(x=>x.id===uid);live.status='ready';live.mimeType=mime||'application/octet-stream';live.expiresAt=Date.now()+DAY;return {id:uid,status:'ready',mimeType:live.mimeType}})})}
  async cancel(id,uid){return this.locked(uid,async()=>{const u=this.ownedUpload(id,uid);await this.db.transaction(d=>{this.member(d,id,u.conversationId);const current=d.uploads.find(x=>x.id===uid&&x.ownerId===id);if(!current||current.status==='bound')throw err('已发送的文件不能取消');current.status='cancelled'});await fs.rm(this.uploadPath(uid),{recursive:true,force:true});return {cancelled:true}})}
  async cleanup(){
    const targets=this.db.read(d=>d.uploads.filter(u=>['cancelled','expired'].includes(u.status)||['uploading','ready'].includes(u.status)&&u.expiresAt<Date.now()))
    for(const target of targets)await this.locked(target.id,async()=>{
      const removed=await this.db.transaction(d=>{const u=d.uploads.find(u=>u.id===target.id);if(u.status==='bound')return false;if(['uploading','ready'].includes(u.status)&&u.expiresAt>=Date.now())return false;u.status='expired';return true})
      if(removed)await fs.rm(this.uploadPath(target.id),{recursive:true,force:true})
    })
    // A crash between file creation and metadata commit must not leak disk forever.
    // Fresh files get a full day grace period so active commits cannot be swept.
    for(const folder of ['files','stickers']){
      const dir=path.join(this.dir,folder)
      const entries=await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})
      for(const entry of entries){
        if(!idPattern.test(entry.name)||entry.isSymbolicLink())continue
        const file=path.join(dir,entry.name),stat=await fs.stat(file).catch(()=>null)
        if(!stat||stat.mtimeMs>Date.now()-DAY)continue
        const referenced=this.db.read(d=>folder==='files'?d.uploads.some(u=>u.id===entry.name):d.stickers.some(s=>s.filename===entry.name))
        if(!referenced)await fs.rm(file,{recursive:folder==='files',force:true})
      }
    }
  }
  attachment(id,uid){return this.db.read(d=>{const u=d.uploads.find(u=>u.id===uid&&u.status==='bound');if(!u)throw err('文件尚未发送或不存在','CHAT_FILE_NOT_FOUND',404);const c=this.member(d,id,u.conversationId),m=d.messages.find(m=>m.id===u.messageId);if(m?.status==='hidden')throw err('此消息已被管理员隐藏','CHAT_MESSAGE_HIDDEN',403);if(!m||m.seq<c.members.find(m=>m.id===id).joinedSeq)throw err('无权读取加入前的附件','CHAT_FORBIDDEN',403);return u})}
  adminAttachment(id,uid){this.admin(id);return this.db.read(d=>{const u=d.uploads.find(u=>u.id===uid&&u.status==='bound');if(!u||!d.messages.some(m=>m.id===u.messageId&&m.conversationId===u.conversationId))throw err('已发送附件不存在','CHAT_FILE_NOT_FOUND',404);return u})}
  ticket(id,uid,options={}){const u=options.admin?this.adminAttachment(id,uid):this.attachment(id,uid);for(const [key,value]of this.tickets)if(value.expiresAt<Date.now())this.tickets.delete(key);if(this.tickets.size>=5000)throw err('下载繁忙，请稍后重试','CHAT_BUSY',503);const ticket=randomBytes(32).toString('hex');this.tickets.set(ticket,{id,uid,admin:options.admin===true,authorize:options.authorize,expiresAt:Date.now()+300000});return {url:`/api/v1/chat/files/${u.id}?ticket=${ticket}`,expiresIn:300}}
  download(uid,ticket,range){const t=this.tickets.get(ticket);if(!t||t.uid!==uid||t.expiresAt<Date.now())throw err('下载链接已失效，请重新点击附件','CHAT_TICKET_EXPIRED',401);if(t.admin&&(!t.authorize||t.authorize().id!==t.id))throw err('管理员会话已失效','ADMIN_REQUIRED',403);const u=t.admin?this.adminAttachment(t.id,uid):this.attachment(t.id,uid);let start=0,end=u.size-1;if(range){const match=String(range).match(/^bytes=(\d*)-(\d*)$/);if(!match||!match[1]&&!match[2])throw err('下载范围无效','CHAT_RANGE_INVALID',416);if(!match[1])start=Math.max(0,u.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]))}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=u.size)throw err('下载范围无效','CHAT_RANGE_INVALID',416)}const directory=this.uploadPath(uid),chunkSize=u.chunkSize;async function* chunks(){for(let i=Math.floor(start/chunkSize);i<=Math.floor(end/chunkSize);i++){const offset=i*chunkSize;for await(const bytes of createReadStream(path.join(directory,String(i)),{start:Math.max(0,start-offset),end:Math.min(chunkSize-1,end-offset)}))yield bytes}}return {u,actorId:t.id,admin:t.admin,start,end,status:range?206:200,stream:Readable.from(chunks())}}
  stickerView(s){return {id:s.id,name:s.name,category:s.category,sortOrder:s.sortOrder,status:s.status,url:`/api/v1/chat/stickers/${s.id}/content`}}
  stickers(id,admin=false){admin?this.admin(id):this.account(id);return this.db.read(d=>({items:d.stickers.filter(s=>admin||s.status==='active').sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)).map(s=>this.stickerView(s))}))}
  async saveSticker(id,input,uid){
    this.admin(id)
    const name=text(input.name,40,true),category=text(input.category,40,true),status=input.status
    if(!['active','hidden'].includes(status)||!Number.isInteger(input.sortOrder)||Math.abs(input.sortOrder)>10000)throw err('表情状态或排序无效')
    let bytes,mime,prepared
    if(input[uploadedImage]){prepared=prepareImage(input);mime=prepared.mimeType}
    if(input.dataBase64){
      if(typeof input.dataBase64!=='string'||input.dataBase64.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64))throw err('表情图片格式无效')
      bytes=Buffer.from(input.dataBase64,'base64');mime=imageMime(bytes)
      if(!mime||bytes.length>2*1024*1024)throw err('表情须为2MB以内的PNG、JPG、GIF或WebP')
    }
    if(!uid&&!bytes&&!prepared)throw err('请上传表情图片')
    const file=(bytes||prepared)?randomUUID():null
    let oldFile,result
    try{
      if(file){await fs.mkdir(path.join(this.dir,'stickers'),{recursive:true,mode:0o700});await writePreparedImage(path.join(this.dir,'stickers',file),prepared||{buffer:bytes})}
      result=await this.db.transaction(d=>{
        this.admin(id)
        let s=uid?d.stickers.find(s=>s.id===uid):null
        if(uid&&!s)throw err('表情不存在','CHAT_STICKER_NOT_FOUND',404)
        if(!s){if(d.stickers.length>=2000)throw err('表情素材已达2000张上限');s={id:randomUUID()};d.stickers.push(s)}
        oldFile=file?s.filename:null
        Object.assign(s,{name,category,status,sortOrder:input.sortOrder,...(file?{filename:file,mimeType:mime,size:prepared?.size||bytes.length}:{})})
        return this.stickerView(s)
      })
    }catch(e){if(file)await fs.rm(path.join(this.dir,'stickers',file),{force:true});throw e}
    // Metadata is committed. Failure to remove a superseded file must not roll it back;
    // the orphan sweeper retries failed deletions after the grace period.
    if(oldFile)await fs.rm(path.join(this.dir,'stickers',oldFile),{force:true}).catch(()=>{})
    return result
  }
  async stickerContent(uid,adminId){if(adminId)this.admin(adminId);const s=this.db.read(d=>d.stickers.find(s=>s.id===uid&&(adminId||s.status==='active')));if(!s)throw err('表情不存在或已下架','CHAT_STICKER_NOT_FOUND',404);return {bytes:createReadStream(path.join(this.dir,'stickers',s.filename)),mimeType:s.mimeType}}
}
