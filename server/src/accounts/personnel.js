import {randomUUID} from 'node:crypto'
import {hashPassword,hmac} from '../auth/crypto.js'
import {auditRecord} from '../audit/metadata.js'
import {parsePersonnelWorkbook,XLSX_BYTES} from './xlsx.js'
import {sealStudentNumber} from './student-number.js'

const types={'学生':'student','校友':'alumni','教师':'faculty','教职工':'staff','普通人员':'member',student:'student',alumni:'alumni',faculty:'faculty',staff:'staff',member:'member'}
const keys=['username','name','personType','department','major','className','studentId','enrollmentYear','graduationYear','expectedGraduationYear']
const limits={username:32,name:80,department:160,major:120,className:80,studentId:40,enrollmentYear:4,graduationYear:4,expectedGraduationYear:4,personType:20}
const fail=(message,code='PERSONNEL_INVALID',statusCode=400,details)=>Object.assign(new Error(message),{code,statusCode,...(details?{details}:{})})
const canonical=value=>String(value||'').normalize('NFKC').trim().toLowerCase()
const mask=value=>!value?'':value.length<=4?'****':'*'.repeat(Math.max(4,value.length-4))+value.slice(-4)
const publicRow=row=>({rowNumber:row.rowNumber,username:row.username,name:row.name,personType:row.personType,department:row.department,major:row.major,className:row.className,studentIdMasked:row.studentIdMasked,enrollmentYear:row.enrollmentYear,graduationYear:row.graduationYear,expectedGraduationYear:row.expectedGraduationYear,errors:[...row.errors]})
function normalizeRow({input,rowNumber,errors=[]},secret){
  const result={rowNumber,errors:[...errors]}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key))){result.errors.push('仅能填写模板中的普通人员资料，不能设置密码、权限或认证标记');return result}
  for(const key of keys){const value=input[key];if(value!=null&&typeof value!=='string'&&typeof value!=='number'){result.errors.push(`${key}字段格式错误`);result[key]='';continue}result[key]=String(value??'').trim();if(result[key].length>limits[key]||/[\u0000-\u001f<>]/.test(result[key]))result.errors.push(`${({username:'用户名',name:'姓名',personType:'身份类型',department:'学院/部门',major:'专业',className:'班级',studentId:'学号/工号'})[key]||'年份'}格式或长度不正确`)}
  result.username=result.username.normalize('NFKC')
  if(!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,31}$/u.test(result.username))result.errors.push('用户名须为2–32位文字、字母、数字或 . _ -，且不能以点或连字符开头')
  if(!result.name)result.errors.push('姓名不能为空')
  result.personType=types[result.personType]||''
  if(!result.personType)result.errors.push('身份类型须为学生、校友、教师、教职工或普通人员')
  if(result.className&&!result.major)result.errors.push('填写班级时须同时填写专业')
  if(result.major&&!result.department)result.errors.push('填写专业时须同时填写学院/部门')
  const yearMax=new Date().getFullYear()+10
  for(const key of ['enrollmentYear','graduationYear','expectedGraduationYear'])if(result[key]&&(!/^\d{4}$/.test(result[key])||Number(result[key])<1900||Number(result[key])>yearMax))result.errors.push(`${{enrollmentYear:'入学',graduationYear:'毕业',expectedGraduationYear:'预计毕业'}[key]}年份须为1900至${yearMax}之间的四位年份`)
  for(const key of ['graduationYear','expectedGraduationYear'])if(result.enrollmentYear&&result[key]&&result[key]<result.enrollmentYear)result.errors.push('毕业或预计毕业年份不能早于入学年份')
  if(result.personType==='student'&&result.graduationYear)result.errors.push('在校学生请填写预计毕业年份；已毕业人员请选择校友')
  result.studentId=result.studentId.replace(/\s+/g,'')
  if(result.studentId&&!/^[A-Za-z0-9_-]{4,40}$/.test(result.studentId))result.errors.push('学号/工号须为4–40位字母、数字、下划线或连字符，并以文本填写')
  result.studentIdMasked=mask(result.studentId)
  result.studentIdKey=result.studentId?hmac(`student-id:${result.studentId}`,secret):''
  result.studentIdSealed=sealStudentNumber(result.studentId,secret)
  delete result.studentId
  result.usernameNormalized=result.username.toLowerCase()
  return result
}
function duplicateRows(rows,accounts){
  const usernames=new Map(),studentIds=new Map()
  for(const row of rows){
    const key=canonical(row.username),nameMatches=accounts.filter(a=>canonical(a.username||a.usernameNormalized)===key)
    if(key&&nameMatches.length)row.errors.push('用户名已存在（含暂停或注销账号），不能覆盖或重置原账号')
    if(row.studentIdKey&&accounts.some(a=>a.studentIdKey===row.studentIdKey))row.errors.push('学号/工号已绑定现有账号，不能重复建立人员')
    for(const [value,map,label] of [[key,usernames,'用户名'],[row.studentIdKey,studentIds,'学号/工号']]){
      if(!value)continue
      if(map.has(value)){const previous=map.get(value);row.errors.push(`${label}与第${previous.rowNumber}行重复`);previous.errors.push(`${label}与第${row.rowNumber}行重复`)}else map.set(value,row)
    }
  }
  return rows
}
export class PersonnelService{
  constructor(accounts){this.accounts=accounts;this.database=accounts.database;this.config=accounts.config;this.previews=new Map()}
  guard(state,actor){if(!state.accounts.some(a=>a.id===actor.id&&a.status==='active'&&a.isAdmin&&a.role!=='delegated_admin'&&a.adminRole!=='delegated_admin'&&!a.mustChangePassword))throw fail('仅有效超级管理员可管理普通人员','ADMIN_PERMISSION_DENIED',403)}
  preview(actor,rows,source='manual'){
    this.database.read(state=>this.guard(state,actor))
    if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw fail('每次须提供1至1000行人员资料')
    const normalized=rows.map(row=>normalizeRow(row,this.config.dataHashSecret))
    duplicateRows(normalized,this.database.read(s=>s.accounts))
    for(const [token,preview] of this.previews)if(preview.expiresAt<Date.now()||preview.actorId===actor.id&&!preview.busy)this.previews.delete(token)
    if(this.previews.size>=20)throw fail('同时处理的导入过多，请稍后重试','PERSONNEL_BUSY',429)
    const token=randomUUID(),preview={token,actorId:actor.id,source,rows:normalized,expiresAt:Date.now()+15*60*1000}
    this.previews.set(token,preview)
    return {token,total:normalized.length,valid:normalized.filter(r=>!r.errors.length).length,invalid:normalized.filter(r=>r.errors.length).length,items:normalized.map(publicRow),expiresInMinutes:15,canVerify:normalized.every(r=>r.studentIdKey&&r.department),initialPasswordRule:'用户名后加123456，首次登录必须修改密码'}
  }
  previewWorkbook(actor,input){
    this.database.read(s=>this.guard(s,actor))
    if(!input||Object.keys(input).some(key=>!['filename','contentBase64'].includes(key))||!String(input.filename||'').toLowerCase().endsWith('.xlsx'))throw fail('请上传.xlsx格式的人员模板文件')
    const value=input.contentBase64
    if(typeof value!=='string'||value.length>Math.ceil(XLSX_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4)throw fail('Excel文件内容无效或超过5MB')
    return this.preview(actor,parsePersonnelWorkbook(Buffer.from(value,'base64')),'xlsx')
  }
  async apply(actor,input,metadata={}){
    if(!input||Object.keys(input).some(k=>!['token','verificationMode','manualVerificationConfirmed','verificationBasis'].includes(k))||!/^[a-f0-9-]{36}$/.test(input.token||''))throw fail('请重新预检后确认导入')
    const done=this.database.read(s=>{this.guard(s,actor);return s.personnelImports?.find(r=>r.token===input.token)})
    if(done){if(done.actorId!==actor.id)throw fail('该导入任务不属于当前管理员','PERSONNEL_PREVIEW_FORBIDDEN',403);return {created:done.accountIds.length,accountIds:done.accountIds,alreadyApplied:true}}
    const preview=this.previews.get(input.token)
    if(!preview||preview.expiresAt<Date.now())throw fail('预检已过期，请重新上传或预检','PERSONNEL_PREVIEW_EXPIRED',409)
    if(preview.actorId!==actor.id)throw fail('该预检不属于当前管理员','PERSONNEL_PREVIEW_FORBIDDEN',403)
    if(preview.busy)throw fail('正在导入，请勿重复确认','PERSONNEL_APPLY_BUSY',409)
    if(preview.rows.some(r=>r.errors.length))throw fail('仍有错误行，请修正后重新预检；本批次尚未导入任何人员','PERSONNEL_ROWS_INVALID',409)
    const verified=input.verificationMode==='manual'
    if(!['unverified','manual'].includes(input.verificationMode))throw fail('请选择待实名校验或已完成人工核验')
    const basis=String(input.verificationBasis||'').trim()
    if(verified&&(input.manualVerificationConfirmed!==true||basis.length<5||basis.length>500||/[\u0000-\u001f<>]/.test(basis)||preview.rows.some(r=>!r.studentIdKey||!r.department)))throw fail('人工核验须确认真实材料已核对、填写至少5字核验依据，并为每人提供学院和学号/工号')
    preview.busy=true
    try{
      const prepared=[]
      // Hash outside the database transaction, two at a time to bound scrypt memory.
      for(let i=0;i<preview.rows.length;i+=2)prepared.push(...await Promise.all(preview.rows.slice(i,i+2).map(async row=>({row,passwordHash:await hashPassword(row.username+'123456')}))))
      const result=await this.database.transaction(state=>{
        this.guard(state,actor)
        const receipt=state.personnelImports?.find(r=>r.token===preview.token)
        if(receipt){if(receipt.actorId!==actor.id)throw fail('导入任务不属于当前管理员','PERSONNEL_PREVIEW_FORBIDDEN',403);return {created:receipt.accountIds.length,accountIds:receipt.accountIds,alreadyApplied:true}}
        const checked=duplicateRows(preview.rows.map(r=>({...r,errors:[]})),state.accounts)
        if(checked.some(r=>r.errors.length))throw fail('预检后已有相同用户名或学号被建立，请重新预检；未导入任何人员','PERSONNEL_IMPORT_CONFLICT',409)
        const timestamp=new Date().toISOString(),ids=[]
        for(const {row,passwordHash} of prepared){
          const {rowNumber,errors,...fields}=row,id=randomUUID()
          const account={...fields,id,passwordHash,schoolSubjectKey:this.accounts.subjectKey(`admin-personnel:${id}`),accountSource:'admin_personnel',status:'active',isAdmin:false,mustChangePassword:true,schoolIdentityVerified:verified,schoolIdentityVerifiedAt:verified?timestamp:null,verificationSource:verified?'admin-personnel-review':'admin-personnel-unverified',alumniStatusVerified:verified&&row.personType==='alumni',createdAt:timestamp,updatedAt:timestamp,lastLoginAt:null,deactivatedAt:null,deactivatedReason:null}
          state.accounts.push(account);ids.push(id)
          state.auditLogs.unshift(auditRecord('account.personnel_created',id,{...metadata,actor:actor.id},{source:preview.source,importToken:preview.token,rowNumber,personType:row.personType,manuallyVerified:verified}))
        }
        state.personnelImports||=[]
        state.personnelImports.push({token:preview.token,actorId:actor.id,accountIds:ids,createdAt:timestamp})
        state.auditLogs.unshift(auditRecord('account.personnel_imported',preview.token,{...metadata,actor:actor.id},{count:ids.length,source:preview.source,manuallyVerified:verified,...(verified?{verificationBasis:basis}:{})}))
        return {created:ids.length,accountIds:ids,alreadyApplied:false}
      })
      this.previews.delete(preview.token)
      return result
    }finally{preview.busy=false}
  }
}
