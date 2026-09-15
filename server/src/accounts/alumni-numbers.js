import {randomUUID} from 'node:crypto'
import {hmac,safeEqual,sha256} from '../auth/crypto.js'
import {auditRecord} from '../audit/metadata.js'

const fail=(message,code='ALUMNI_NUMBER_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const hasNumber=account=>Boolean(String(account.alumniNo||'').trim())
const isDemo=account=>account.localDevelopmentOnly===true||account.developmentSchoolIdentityFixture===true||account.isDemo===true||account.isMock===true||[account.accountSource,account.verificationSource].some(value=>/^(?:local-development|demo|mock)(?:[-_:]|$)/i.test(String(value||'')))
export function alumniNumberSkipReason(account){
  if(isDemo(account))return 'demo'
  if(account.status!=='active')return 'inactive'
  if(account.schoolIdentityVerified!==true)return 'unverified'
  if(hasNumber(account))return 'alreadyAssigned'
  return ''
}
export function reservedAlumniNumbers(state){
  return new Set([
    ...(state.accounts||[]).map(account=>account.alumniNo),
    ...(state.manualIdentityVerifications||[]).map(application=>application.approvedIdentity?.alumniNo)
  ].map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))
}
function generateNumber(used,year,random){
  for(let attempt=0;attempt<20;attempt++){
    const suffix=random().replace(/-/g,'').slice(0,8).toUpperCase()
    if(!/^[A-F0-9]{8}$/.test(suffix))throw fail('校友编号生成器暂时不可用','ALUMNI_NUMBER_GENERATION_FAILED',503)
    const value=`HUFE-${year}-${suffix}`
    if(!used.has(value)){used.add(value);return value}
  }
  throw fail('暂时无法生成唯一校友编号，请稍后重试','ALUMNI_NUMBER_GENERATION_FAILED',503)
}
function report(state){
  const counts={alreadyAssigned:0,unverified:0,inactive:0,demo:0},eligible=[]
  for(const account of state.accounts){const reason=alumniNumberSkipReason(account);if(reason)counts[reason]++;else eligible.push(account)}
  eligible.sort((a,b)=>String(a.id).localeCompare(String(b.id)))
  return {total:state.accounts.length,eligible:eligible.length,skipped:state.accounts.length-eligible.length,skippedReasons:counts,accounts:eligible}
}
function snapshot(state){
  const rows=state.accounts.map(account=>[account.id,alumniNumberSkipReason(account),String(account.alumniNo||''),Number(account.accountRevision||0),account.status,account.schoolIdentityVerified===true,account.name||'',account.username||'',account.personType||'',account.department||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
  return sha256(JSON.stringify({rows,reserved:[...reservedAlumniNumbers(state)].sort()}))
}
function reasonOf(input,confirmation){
  if(input.confirmation!==confirmation)throw fail('请核对下发范围并完成二次确认','ALUMNI_NUMBER_CONFIRM_REQUIRED')
  const reason=typeof input.reason==='string'?input.reason.trim():''
  if(reason.length<5||reason.length>300||/[\u0000-\u001f<>]/.test(reason))throw fail('请填写5至300字下发原因，不填写密码、证件号等敏感资料','ALUMNI_NUMBER_REASON_INVALID')
  return reason
}
function validInput(input,keys){return input&&typeof input==='object'&&!Array.isArray(input)&&!Object.keys(input).some(key=>!keys.includes(key))}

export class AlumniNumberService{
  constructor(accounts,{now=()=>Date.now(),random=randomUUID}={}){this.accounts=accounts;this.database=accounts.database;this.secret=accounts.config.dataHashSecret;this.now=now;this.random=random}
  guard(state,actor){
    const current=state.accounts.find(account=>account.id===actor?.id&&account.status==='active')
    if(current?.isAdmin!==true||current.mustChangePassword||[current.role,current.adminRole].some(role=>role&&!['admin','super_admin'].includes(role)))throw fail('仅当前有效全局管理员可以下发校友编号','ADMIN_PERMISSION_DENIED',403)
    if(Number(current.credentialRevision||0)!==Number(actor.credentialRevision||0))throw fail('管理员登录状态已变化，请重新登录','CREDENTIALS_CHANGED',401)
  }
  target(state,id,revision){
    const account=state.accounts.find(item=>item.id===id)
    if(!account)throw fail('该账号不存在','ALUMNI_NUMBER_INELIGIBLE',409)
    if(!Number.isInteger(revision)||revision!==Number(account.accountRevision||0))throw fail('账号资料已变化，请刷新后重新核对','ACCOUNT_REVISION_CONFLICT',409)
    if(hasNumber(account))throw fail('该账号已有校友编号，保留原编号，不重复下发','ALUMNI_NUMBER_ALREADY_ASSIGNED',409)
    if(alumniNumberSkipReason(account))throw fail('仅正常、已实名且非演示人员可以下发校友编号','ALUMNI_NUMBER_INELIGIBLE',409)
    return account
  }
  async issue(actor,id,input,metadata={}){
    this.database.read(state=>this.guard(state,actor))
    if(!validInput(input,['expectedRevision','reason','confirmation']))throw fail('下发参数无效')
    const reason=reasonOf(input,'确认下发校友编号')
    return this.database.transaction(state=>{
      this.guard(state,actor)
      const account=this.target(state,id,input.expectedRevision),timestamp=new Date(this.now()).toISOString()
      const alumniNo=generateNumber(reservedAlumniNumbers(state),new Date(this.now()).getUTCFullYear(),this.random)
      this.assign(account,alumniNo,timestamp)
      state.auditLogs.unshift(auditRecord('account.alumni_number_issued',account.id,{...metadata,actor:actor.id},{reason,alumniNo,revision:account.accountRevision,scope:'single'}))
      return {issued:true,accountId:account.id,alumniNo,revision:account.accountRevision,account:this.accounts.authenticatedAccount(account)}
    })
  }
  assign(account,alumniNo,timestamp){
    account.alumniNo=alumniNo
    account.accountRevision=Number(account.accountRevision||0)+1
    account.profileRevision=Number(account.profileRevision||0)+1
    account.updatedAt=timestamp
  }
  preview(actor,input={}){
    if(!validInput(input,[]))throw fail('批量范围固定为所有已实名人员，不接受自定义范围')
    return this.database.read(state=>{
      this.guard(state,actor)
      const counts=report(state),issuedAt=this.now(),expiresAt=issuedAt+10*60*1000
      const payload={version:1,batchId:randomUUID(),actorId:actor.id,credentialRevision:Number(actor.credentialRevision||0),scope:'all_verified',snapshot:snapshot(state),issuedAt,expiresAt}
      const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url'),token=encoded+'.'+hmac('alumni-number-preview:'+encoded,this.secret)
      return {token,scope:'all_verified',expiresAt:new Date(expiresAt).toISOString(),expiresInMinutes:10,total:counts.total,eligible:counts.eligible,skipped:counts.skipped,skippedReasons:counts.skippedReasons,sample:counts.accounts.slice(0,50).map(account=>({id:account.id,name:account.name||'',username:account.username||'',personType:account.personType||'',department:account.department||''})),sampleLimit:50}
    })
  }
  readPreview(token,actor){
    if(typeof token!=='string'||token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw fail('请重新生成下发预览','ALUMNI_NUMBER_PREVIEW_EXPIRED',409)
    const [encoded,signature]=token.split('.')
    if(!safeEqual(signature,hmac('alumni-number-preview:'+encoded,this.secret)))throw fail('预览凭证无效，请重新预览','ALUMNI_NUMBER_PREVIEW_EXPIRED',409)
    let preview
    try{preview=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))}catch{throw fail('预览凭证无效，请重新预览','ALUMNI_NUMBER_PREVIEW_EXPIRED',409)}
    if(preview?.version!==1||preview.scope!=='all_verified'||typeof preview.batchId!=='string'||typeof preview.snapshot!=='string'||!Number.isFinite(preview.expiresAt)||!Number.isFinite(preview.issuedAt)||preview.issuedAt>this.now()||preview.expiresAt<=this.now())throw fail('预览已过期，请重新核对下发范围','ALUMNI_NUMBER_PREVIEW_EXPIRED',409)
    if(preview.actorId!==actor.id)throw fail('该预览不属于当前管理员，请重新预览','ALUMNI_NUMBER_PREVIEW_FORBIDDEN',403)
    if(preview.credentialRevision!==Number(actor.credentialRevision||0))throw fail('管理员凭据已变化，请重新登录并预览','CREDENTIALS_CHANGED',401)
    return preview
  }
  async apply(actor,input,metadata={}){
    this.database.read(state=>this.guard(state,actor))
    if(!validInput(input,['token','reason','confirmation']))throw fail('批量下发参数无效')
    const reason=reasonOf(input,'确认批量下发校友编号'),preview=this.readPreview(input.token,actor),reasonHash=sha256(reason)
    return this.database.transaction(state=>{
      this.guard(state,actor)
      this.readPreview(input.token,actor)
      const previous=(state.alumniNumberBatches||[]).find(batch=>batch.id===preview.batchId)
      if(previous){
        if(previous.actorId!==actor.id||previous.reasonHash!==reasonHash)throw fail('该批次已确认，不可变更下发原因后重复提交','ALUMNI_NUMBER_BATCH_CONFLICT',409)
        return {batchId:previous.id,issuedCount:previous.issuedCount,alreadyApplied:true,scope:'all_verified'}
      }
      if(snapshot(state)!==preview.snapshot)throw fail('预览后人员资格、资料或编号已变化，请重新预览；本次未下发任何编号','ALUMNI_NUMBER_PREVIEW_CHANGED',409)
      const counts=report(state)
      if(!counts.eligible)throw fail('没有需要下发编号的已实名人员，现有编号将保持不变','ALUMNI_NUMBER_NOTHING_TO_ISSUE',409)
      const used=reservedAlumniNumbers(state),timestamp=new Date(this.now()).toISOString(),year=new Date(this.now()).getUTCFullYear()
      for(const account of counts.accounts){
        const alumniNo=generateNumber(used,year,this.random)
        this.assign(account,alumniNo,timestamp)
        state.auditLogs.unshift(auditRecord('account.alumni_number_issued',account.id,{...metadata,actor:actor.id},{batchId:preview.batchId,alumniNo,reason,revision:account.accountRevision,scope:'all_verified'}))
      }
      ;(state.alumniNumberBatches||=[]).push({id:preview.batchId,actorId:actor.id,issuedCount:counts.eligible,reasonHash,createdAt:timestamp})
      state.auditLogs.unshift(auditRecord('account.alumni_numbers_batch_issued',preview.batchId,{...metadata,actor:actor.id},{reason,issuedCount:counts.eligible,scope:'all_verified',skipped:counts.skipped,skippedReasons:counts.skippedReasons}))
      return {batchId:preview.batchId,issuedCount:counts.eligible,alreadyApplied:false,scope:'all_verified'}
    })
  }
}
