import {randomUUID} from 'node:crypto'
import {hmac,safeEqual} from '../auth/crypto.js'
import {auditRecord} from '../audit/metadata.js'
import {sealStudentNumber,selfStudentNumber} from './student-number.js'

const fail=(message,code='ACCOUNT_VERIFICATION_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
const fields={name:80,personType:20,department:120,major:120,className:80,studentId:40,enrollmentYear:4,graduationYear:4,expectedGraduationYear:4}
const years=['enrollmentYear','graduationYear','expectedGraduationYear']
const demo=a=>a.localDevelopmentOnly===true||a.developmentSchoolIdentityFixture===true||a.isDemo===true||a.isMock===true||[a.accountSource,a.verificationSource].some(v=>/^(?:local-development|demo|mock)(?:[-_:]|$)/i.test(String(v||'')))
const privileged=a=>Boolean(a.isAdmin||a.isSuperAdmin)||[a.role,a.adminRole].some(v=>['admin','super_admin'].includes(v))
const mask=id=>id.length<=4?'****':'*'.repeat(Math.max(4,id.length-4))+id.slice(-4)
const source='admin-personnel-review'

function identity(input,current,secret){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(fields,k))||Object.keys(fields).some(k=>!Object.hasOwn(input,k)))throw fail('请逐项核对身份资料，未提供的学籍字段可留空')
  const next={}
  for(const [key,max] of Object.entries(fields)){
    let value=input[key]
    if(years.includes(key)&&typeof value==='number')value=String(value)
    if(typeof value!=='string'||/[\u0000-\u001f<>]/.test(value))throw fail('身份字段格式不正确')
    value=key==='studentId'?value.replace(/\s+/g,''):value.trim()
    if(value.length>max)throw fail(`${{name:'姓名',department:'学院/部门',major:'专业',className:'班级',studentId:'学号/工号'}[key]||'身份字段'}超过允许长度`)
    next[key]=value
  }
  if(!next.name||!next.department||!['student','alumni','faculty','staff'].includes(next.personType))throw fail('请核对姓名、学院/部门，并明确学生、校友、教师或教职工身份')
  if(next.className&&!next.major||next.major&&!next.department)throw fail('班级须同时提供专业，专业须同时提供学院/部门')
  const maxYear=new Date().getFullYear()+10
  for(const key of years)if(next[key]&&(!/^\d{4}$/.test(next[key])||Number(next[key])<1900||Number(next[key])>maxYear))throw fail(`年份须为1900至${maxYear}之间的四位年份`)
  for(const key of ['graduationYear','expectedGraduationYear'])if(next.enrollmentYear&&next[key]&&next[key]<next.enrollmentYear)throw fail('毕业或预计毕业年份不能早于入学年份')
  if(next.personType==='student'&&next.graduationYear)throw fail('在校学生请填写预计毕业年份，已毕业人员请选择校友')
  if(next.personType!=='student'&&next.expectedGraduationYear)throw fail('仅在校学生使用预计毕业年份，请核对身份与毕业年份')
  const number=next.studentId||selfStudentNumber(current,secret)
  if(!/^[A-Za-z0-9_.-]{4,40}$/.test(number))throw fail('请核对并填写完整学号/工号；当前账号未保存可验证的完整号码','ACCOUNT_VERIFICATION_STUDENT_ID_REQUIRED')
  const studentIdKey=hmac(`student-id:${number}`,secret)
  if(current.studentIdKey&&!safeEqual(current.studentIdKey,studentIdKey))throw fail('学号/工号与已保存身份不一致，请先通过独立身份纠错流程核对，不可在认证通过时换号','ACCOUNT_VERIFICATION_IDENTITY_CHANGED',409)
  delete next.studentId
  return {number,fields:{...next,studentIdKey,studentIdMasked:mask(number),studentIdSealed:sealStudentNumber(number,secret)}}
}

export class DirectVerificationService {
  constructor(accounts){this.accounts=accounts;this.database=accounts.database;this.secret=accounts.config.dataHashSecret}
  guard(state,actor){
    const current=state.accounts.find(a=>a.id===actor?.id&&a.status==='active')
    if(current?.isAdmin!==true||current.mustChangePassword||[current.role,current.adminRole].some(v=>v&&!['admin','super_admin'].includes(v)))throw fail('仅有效全局管理员可完成人工实名校验','ADMIN_PERMISSION_DENIED',403)
    if(Number(current.credentialRevision||0)!==Number(actor.credentialRevision||0))throw fail('管理员登录状态已变化，请重新登录','CREDENTIALS_CHANGED',401)
  }
  target(state,id,expectedRevision){
    const account=state.accounts.find(a=>a.id===id)
    if(!account||account.status!=='active'||account.accountSource!=='admin_personnel'||account.schoolIdentityVerified===true||privileged(account)||demo(account))throw fail('仅可核验后台录入、正常且待实名的普通人员；不能覆盖已有实名结论、运营来源账号或全局管理员','ACCOUNT_VERIFICATION_UNAVAILABLE',409)
    if(!Number.isInteger(expectedRevision)||expectedRevision!==Number(account.accountRevision||0))throw fail('账号资料已变化，请刷新后重新核对','ACCOUNT_REVISION_CONFLICT',409)
    return account
  }
  unique(state,target,next){
    if(state.accounts.some(a=>a.id!==target.id&&['schoolSubjectKey','idCardKey','studentIdKey'].some(key=>(key==='studentIdKey'?next.studentIdKey:target[key])&&(key==='studentIdKey'?next.studentIdKey:target[key])===a[key])))throw fail('该稳定身份已关联其他账号（含暂停或注销账号），请先处理重复身份','ACCOUNT_VERIFICATION_IDENTITY_CONFLICT',409)
    if((state.identityConflicts||[]).some(r=>r.status==='open'&&(r.accountIds?.includes(target.id)||target.schoolSubjectKey&&r.schoolSubjectKey===target.schoolSubjectKey)))throw fail('该账号存在待处理的身份冲突，请先处理原冲突记录','ACCOUNT_VERIFICATION_IDENTITY_CONFLICT',409)
    if((state.manualIdentityVerifications||[]).some(r=>['submitted','under_review','needs_more','approved'].includes(r.status)&&[r.profile,r.approvedIdentity].some(p=>p&&(p.studentIdKey===next.studentIdKey||target.idCardKey&&p.idCardKey===target.idCardKey))))throw fail('该身份已有进行中或已通过的人工申请，请先处理原人工复核流程','ACCOUNT_VERIFICATION_APPLICATION_CONFLICT',409)
  }
  async verify(actor,id,input,metadata={}){
    this.database.read(state=>this.guard(state,actor))
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','fields','verificationBasis','confirmation'].includes(k)))throw fail('人工核验参数无效')
    if(input.confirmation!=='确认人工实名校验通过')throw fail('请确认已核对真实材料并二次确认人工实名校验通过','ACCOUNT_VERIFICATION_CONFIRM_REQUIRED')
    const basis=typeof input.verificationBasis==='string'?input.verificationBasis.trim():''
    if(basis.length<5||basis.length>500||/[\u0000-\u001f<>]/.test(basis))throw fail('请填写5至500字核验依据（材料名称、核对方式），不要填写敏感号码')
    this.database.read(state=>identity(input.fields,this.target(state,id,input.expectedRevision),this.secret))
    return this.database.transaction(state=>{
      this.guard(state,actor)
      const account=this.target(state,id,input.expectedRevision),verified=identity(input.fields,account,this.secret)
      this.unique(state,account,verified.fields)
      if(basis.replace(/\s+/g,'').includes(verified.number))throw fail('核验依据请勿填写完整学号/工号，仅记录核对材料与方式','ACCOUNT_VERIFICATION_BASIS_SENSITIVE')
      const timestamp=new Date().toISOString(),reviewId=randomUUID(),nextRevision=Number(account.accountRevision||0)+1
      const {studentIdKey,studentIdSealed,...snapshot}=verified.fields
      ;(state.accountManualVerifications||=[]).push({id:reviewId,actorId:actor.id,targetId:account.id,verifiedAt:timestamp,verificationBasis:basis,verificationSource:source,fromRevision:Number(account.accountRevision||0),toRevision:nextRevision,reviewedFields:snapshot})
      Object.assign(account,verified.fields,{schoolIdentityVerified:true,schoolIdentityVerifiedAt:timestamp,verificationSource:source,alumniStatusVerified:verified.fields.personType==='alumni',educationSyncedAt:timestamp,accountRevision:nextRevision,profileRevision:Number(account.profileRevision||0)+1,updatedAt:timestamp})
      delete account.educationSupplement
      state.auditLogs.unshift(auditRecord('account.personnel_manually_verified',account.id,{...metadata,actor:actor.id},{reviewId,verificationSource:source,verificationBasis:basis,reviewedFields:snapshot,revision:nextRevision}))
      return {verified:true,revision:nextRevision,verificationSource:source,account:this.accounts.authenticatedAccount(account)}
    })
  }
}
