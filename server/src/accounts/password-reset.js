import {hashPassword,verifyPassword} from '../auth/crypto.js'
import {auditRecord} from '../audit/metadata.js'
import {validatePassword} from './service.js'

const fail=(message,code='PASSWORD_RESET_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
export class PasswordResetService {
  constructor(accounts,sessions){this.database=accounts.database;this.sessions=sessions}
  guard(state,actor){
    const current=state.accounts.find(a=>a.id===actor.id&&a.status==='active')
    if(current?.isAdmin!==true||current.mustChangePassword||[current.role,current.adminRole].some(role=>role&&role!=='super_admin'&&role!=='admin'))throw fail('仅当前有效全局管理员可修改平台账号密码','ADMIN_PERMISSION_DENIED',403)
    if(Number(current.credentialRevision||0)!==Number(actor.credentialRevision||0))throw fail('管理员登录状态已变化，请重新登录','CREDENTIALS_CHANGED',401)
    return current
  }
  target(state,id,input){
    const target=state.accounts.find(a=>a.id===id)
    if(!target||target.status!=='active'||!target.passwordHash)throw fail('只能为当前正常且已设置平台密码的账号修改密码','ACCOUNT_RESET_UNAVAILABLE',409)
    if(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==Number(target.accountRevision||0))throw fail('账号已被其他操作更新，请刷新后重新确认','ACCOUNT_REVISION_CONFLICT',409)
    return target
  }
  async reset(actor,id,input,metadata={}){
    this.database.read(state=>this.guard(state,actor))
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['newPassword','confirmPassword','currentPassword','reason','expectedRevision','confirmation'].includes(key)))throw fail('密码修改参数无效')
    if(input.confirmation!=='确认修改该账号密码')throw fail('请完成密码修改二次确认','PASSWORD_RESET_CONFIRM_REQUIRED')
    if(typeof input.newPassword!=='string'||typeof input.confirmPassword!=='string'||input.newPassword!==input.confirmPassword)throw fail('两次输入的新密码不一致')
    const next=validatePassword(input.newPassword,'新密码')
    if(!/[A-Za-z]/.test(next)||!/[0-9]/.test(next))throw fail('新密码至少8位，并同时包含字母和数字','INVALID_PASSWORD')
    const reason=typeof input.reason==='string'?input.reason.trim():''
    if(reason.length<5||reason.length>300||/[\u0000-\u001f<>]/.test(reason)||reason.includes(next)||(input.currentPassword&&reason.includes(input.currentPassword)))throw fail('请填写5至300字操作原因，请勿在原因中填写任何密码','PASSWORD_RESET_REASON_INVALID')
    const candidate=this.database.read(state=>this.target(state,id,input)),self=actor.id===id
    if(self&&(!input.currentPassword||!await verifyPassword(String(input.currentPassword),candidate.passwordHash)))throw fail('当前密码不正确','CURRENT_PASSWORD_INVALID',400)
    if(await verifyPassword(next,candidate.passwordHash))throw fail('新密码不能与当前密码相同','PASSWORD_UNCHANGED')
    const passwordHash=await hashPassword(next)
    const result=await this.database.transaction(state=>{
      this.guard(state,actor)
      const target=this.target(state,id,input)
      if(target.passwordHash!==candidate.passwordHash)throw fail('账号密码已更新，请刷新后重新确认','ACCOUNT_REVISION_CONFLICT',409)
      const timestamp=new Date().toISOString()
      target.passwordHash=passwordHash;target.accountRevision=Number(target.accountRevision||0)+1;target.credentialRevision=Number(target.credentialRevision||0)+1
      target.mustChangePassword=!self;target.passwordChangedAt=timestamp;target.updatedAt=timestamp
      state.auditLogs.unshift(auditRecord('account.admin_password_reset',id,{...metadata,actor:actor.id},{reason,revision:target.accountRevision,self,mustChangePassword:!self,sessionsRevoked:true}))
      return {accountId:id,revision:target.accountRevision,passwordChanged:true,mustChangePassword:!self,loginRequired:self}
    })
    await this.sessions.revokeAccount(id)
    return result
  }
}
