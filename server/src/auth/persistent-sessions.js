import {hmac,randomToken,sha256} from './crypto.js'
import {auditRecord} from '../audit/metadata.js'

const failure=(message,code='ACCESS_TOKEN_EXPIRED',statusCode=401)=>Object.assign(new Error(message),{code,statusCode})
const revision=account=>Number(account?.credentialRevision||0)
const policy={persistent:true,singleDevice:true,expiresAutomatically:false}
const messages={SESSION_REPLACED:'账号已在其他设备登录，当前设备已退出',CREDENTIALS_CHANGED:'密码或账号状态已更新，请重新登录',SESSION_REVOKED:'登录已退出，请重新登录'}

// Only token/device hashes are stored. A login is not presence and does not have
// a wall-clock expiry: the current device remains valid until explicit revocation.
export class PersistentSessions {
  constructor(database,secret){
    this.database=database;this.secret=secret
    this.sequence=database.read(s=>(s.authDeviceSessions||[]).reduce((n,r)=>Math.max(n,Number(r.loginSequence)||0),Date.now()))
    this.sequence=database.read(s=>Object.values(s.authSessionBarriers||{}).reduce((n,v)=>Math.max(n,Number(v)||0),this.sequence))
    this.reindex()
  }
  reindex(){
    this.index=this.database.read(state=>{
      const index=new Map()
      for(const row of state.authDeviceSessions||[])for(const token of row.tokens)index.set(token.hash,{accountId:row.accountId,sessionId:row.sessionId})
      for(const row of state.authRevokedTokens||[])index.set(row.hash,{code:row.code})
      return index
    })
  }
  beginLogin(){return ++this.sequence}
  deviceHash(value){
    // Legacy clients still have to authenticate and receive a new device scope.
    const id=value===undefined||value===null||value===''?'legacy_'+randomToken(24):value
    if(typeof id!=='string'||!/^[-A-Za-z0-9_]{16,128}$/.test(id))throw failure('设备标识无效，请刷新后重新登录','DEVICE_ID_INVALID',400)
    return hmac('login-device:'+id,this.secret)
  }
  rememberRevoked(state,tokens,code){
    const old=(state.authRevokedTokens||[]).filter(r=>!tokens.some(t=>t.hash===r.hash))
    state.authRevokedTokens=[...old,...tokens.map(t=>({hash:t.hash,code}))].slice(-4096)
  }
  async issue(account,deviceId,metadata={},attempt=this.beginLogin()){
    const deviceHash=this.deviceHash(deviceId),token=randomToken(40),hash=sha256(token)
    await this.database.transaction(state=>{
      const current=state.accounts.find(a=>a.id===account.id)
      if(!current||current.status!=='active')throw failure('账号已停用或注销','ACCOUNT_INACTIVE')
      if(revision(current)!==revision(account))throw failure(messages.CREDENTIALS_CHANGED,'CREDENTIALS_CHANGED')
      const rows=state.authDeviceSessions||=[]
      if((state.authSessionBarriers?.[account.id]||0)>attempt)throw failure('当前登录请求已取消，请重新登录','LOGIN_SUPERSEDED',409)
      let row=rows.find(r=>r.accountId===account.id)
      if(row&&row.loginSequence>attempt)throw failure('较新的登录已经完成，请使用当前登录状态','LOGIN_SUPERSEDED',409)
      const replaced=Boolean(row&&row.deviceHash!==deviceHash)
      if(row&&(replaced||row.credentialRevision!==revision(current))){
        this.rememberRevoked(state,row.tokens,replaced?'SESSION_REPLACED':'CREDENTIALS_CHANGED')
        rows.splice(rows.indexOf(row),1);row=null
      }
      if(!row){row={accountId:account.id,sessionId:randomToken(24),deviceHash,credentialRevision:revision(current),createdAt:new Date().toISOString(),tokens:[]};rows.push(row)}
      row.loginSequence=attempt;row.lastAuthenticatedAt=new Date().toISOString()
      row.tokens.push({hash,createdAt:row.lastAuthenticatedAt})
      if(row.tokens.length>32)this.rememberRevoked(state,row.tokens.splice(0,row.tokens.length-32),'SESSION_REVOKED')
      state.auditLogs.unshift(auditRecord(replaced?'session.device_replaced':'session.device_authenticated',account.id,{...metadata,actor:account.id},{singleDevice:true,sameDevice:!replaced,persistent:true}))
    })
    this.reindex()
    return {accessToken:token,tokenType:'Bearer',expiresAt:null,sessionPolicy:{...policy},user:account}
  }
  authenticate(token){
    const hash=sha256(token),entry=this.index.get(hash)
    if(!entry)throw failure('登录已失效，请重新登录')
    if(entry.code)throw failure(messages[entry.code]||'登录已失效，请重新登录',entry.code)
    return this.database.read(state=>{
      const row=(state.authDeviceSessions||[]).find(r=>r.accountId===entry.accountId)
      if(!row||row.sessionId!==entry.sessionId||!row.tokens.some(t=>t.hash===hash)){
        const code=(state.authRevokedTokens||[]).find(r=>r.hash===hash)?.code||'SESSION_REVOKED'
        throw failure(messages[code]||'登录已失效，请重新登录',code)
      }
      const account=state.accounts.find(a=>a.id===entry.accountId)
      if(!account||account.status!=='active')throw failure('账号已停用或注销','ACCOUNT_INACTIVE')
      if(revision(account)!==row.credentialRevision)throw failure(messages.CREDENTIALS_CHANGED,'CREDENTIALS_CHANGED')
      return {id:account.id,credentialRevision:row.credentialRevision}
    })
  }
  async revoke(token,metadata={}){
    const hash=sha256(token),entry=this.index.get(hash)
    if(!entry?.accountId)return
    const barrier=this.beginLogin()
    await this.database.transaction(state=>{
      const row=(state.authDeviceSessions||[]).find(r=>r.accountId===entry.accountId&&r.sessionId===entry.sessionId&&r.tokens.some(t=>t.hash===hash))
      if(!row)return // A late logout from the old device cannot kick a new login.
      ;(state.authSessionBarriers||={})[entry.accountId]=barrier
      this.rememberRevoked(state,row.tokens,'SESSION_REVOKED')
      state.authDeviceSessions=state.authDeviceSessions.filter(r=>r!==row)
      state.auditLogs.unshift(auditRecord('session.logged_out',entry.accountId,{...metadata,actor:entry.accountId},{singleDevice:true}))
    })
    this.reindex()
  }
  async revokeAccount(accountId){
    const barrier=this.beginLogin()
    await this.database.transaction(state=>{
      ;(state.authSessionBarriers||={})[accountId]=barrier
      const rows=(state.authDeviceSessions||[]).filter(r=>r.accountId===accountId)
      if(!rows.length)return
      this.rememberRevoked(state,rows.flatMap(r=>r.tokens),'CREDENTIALS_CHANGED')
      state.authDeviceSessions=state.authDeviceSessions.filter(r=>r.accountId!==accountId)
    })
    this.reindex()
  }
}
