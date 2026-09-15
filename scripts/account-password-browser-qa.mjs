// Reproducible, temporary-account-only browser acceptance. No real service/data is used.
import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createServer} from '../admin/node_modules/vite/dist/node/index.js'
import {buildApp} from '../server/src/app.js'
import {createConfig} from '../server/src/config.js'

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-password-browser-')),apiOrigin='http://127.0.0.1:8891',adminOrigin='http://127.0.0.1:4291'
const old='IsolatedBrowserOld2026!',next='IsolatedBrowserNext2026!',own='IsolatedBrowserOwn2026!'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let app,vite,chrome,socket
try{
  const contentService={init:async()=>{},startScheduler(){},stopScheduler(){},status:()=>({}),home:()=>({sections:{}}),list:()=>({items:[]})}
  app=await buildApp({config:createConfig({env:'test',dataFile:path.join(dir,'data.json'),mediaDir:path.join(dir,'media'),cacheFile:path.join(dir,'content.json'),auditGeoDir:path.join(dir,'ip-region'),publicBaseUrl:apiOrigin,corsOrigins:[adminOrigin],trustProxy:false}),logger:false,refreshContent:false,scheduleContent:false,contentService})
  const users={}
  for(const id of ['admin','member','delegate'])users[id]=await app.services.accounts.register({schoolSubject:'password-browser-only-'+id,name:'隔离改密验收'+id,department:'临时测试学院',personType:'alumni',schoolIdentityVerified:true,isAdmin:id==='admin',verificationSource:'disposable-browser-fixture'},{username:'reset_qa_'+id,password:old})
  await app.services.database.transaction(state=>{const row=state.accounts.find(a=>a.id===users.delegate.id);row.isAdmin=true;row.adminRole='delegated_admin'})
  await app.listen({host:'127.0.0.1',port:8891})
  process.env.HUFE_API_PROXY=apiOrigin
  vite=await createServer({root:path.resolve('admin'),configFile:path.resolve('admin/vite.config.js'),server:{host:'127.0.0.1',port:4291,strictPort:true}});await vite.listen()
  chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${path.join(dir,'chrome')}`,'--remote-debugging-port=9496','about:blank'],{stdio:'ignore'})
  let tabs;for(let i=0;i<50;i++){try{tabs=await(await fetch('http://127.0.0.1:9496/json/list')).json();if(tabs.length)break}catch{}await wait(100)}
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let serial=0;const pending=new Map(),events=[]
  socket.onmessage=e=>{const p=JSON.parse(e.data);if(p.id){const call=pending.get(p.id);pending.delete(p.id);p.error?call.reject(new Error(JSON.stringify(p.error))):call.resolve(p.result)}else events.push(p)}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
  const until=async(expression,label)=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await wait(100)}throw Error('Timed out: '+label)}
  const fill=async(selector,value)=>evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});if(!field)throw Error('field unavailable');field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const request=async(url,payload,token)=>{const r=await fetch(apiOrigin+'/api/v1'+url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()}}
  const resetInput={newPassword:next,confirmPassword:next,reason:'隔离浏览器验证后台重置密码',expectedRevision:0,confirmation:'确认修改该账号密码'}
  for(const id of ['member','delegate']){const issued=app.services.sessions.issueAccess(app.services.accounts.getActiveAccount(users[id].id));const result=await request('/admin/accounts/'+users.member.id+'/password',resetInput,issued.accessToken);if(result.status!==403)throw Error('Unauthorized reset was not forbidden')}
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:adminOrigin+'/#/login'})
  await until('!!document.querySelector("input[autocomplete=username]")','login form')
  await fill('input[autocomplete=username]','reset_qa_admin');await fill('input[type=password]',old);await click('form button[type=submit]');await until('location.hash.includes("dashboard")','admin login')
  await evaluate(`location.hash='#/accounts'`);await until(`document.querySelector('table')?.textContent.includes('reset_qa_member')`,'account list')
  const openTarget=async username=>{await evaluate(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes(${JSON.stringify(username)}));[...row.querySelectorAll('button')].find(button=>button.textContent.includes('修改密码')).click()})()`);await until('!!document.querySelector(".password-reset-content")','password dialog')}
  await openTarget('reset_qa_member')
  const layout=[]
  for(const width of [695,430]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:695,deviceScaleFactor:1,mobile:false});await wait(700)
    const before=await evaluate(`(()=>{const d=document.querySelector('.dialog-card'),s=document.querySelector('.dialog-scroll'),f=document.querySelector('.dialog-actions');return {width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height,maxHeight:getComputedStyle(d).maxHeight,dialog:d.getBoundingClientRect().toJSON(),scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,footer:f.getBoundingClientRect().toJSON(),overflow:getComputedStyle(s).overflowY}})()`)
    if(before.dialog.left<0||before.dialog.right>width+1||before.footer.bottom>695||!['auto','scroll'].includes(before.overflow))throw Error('Password modal not bounded/scrollable: '+JSON.stringify(before))
    await evaluate(`document.querySelector('.dialog-scroll').scrollTop=9999`);layout.push({...before,scrolled:await evaluate(`document.querySelector('.dialog-scroll').scrollTop`)})
    const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.resolve('.local-runtime/password-dialog-'+width+'.png'),Buffer.from(shot.data,'base64'))
  }
  await fill('.password-reset-content input[type=password]:nth-of-type(1)',next)
  // Each password input is nested in a separate label, select using the input collection.
  await evaluate(`(()=>{const fields=document.querySelectorAll('.password-reset-content input[type=password]');for(const field of fields){field.value=${JSON.stringify(next)};field.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
  await fill('.password-reset-content textarea','隔离浏览器确认本人申请重置密码');await click('.dialog-actions button:last-child');await until(`document.querySelector('.dialog-card')?.textContent.includes('再次确认修改密码')`,'second confirmation')
  if(app.services.database.read(s=>s.accounts.find(a=>a.id===users.member.id).accountRevision||0)!==0)throw Error('Password changed before explicit confirmation')
  await click('.dialog-actions button:last-child');await until(`!document.querySelector('.password-reset-content')`,'password reset committed')
  const denied=await request('/auth/login',{username:'reset_qa_member',password:old});if(denied.status!==401)throw Error('Old password still accepted')
  const accepted=await request('/auth/login',{username:'reset_qa_member',password:next});if(accepted.status!==200||!accepted.body.data.user.mustChangePassword)throw Error('New temporary password flow failed')
  const final=await request('/auth/change-password',{currentPassword:next,newPassword:'IsolatedMemberFinal2026!'},accepted.body.data.accessToken);if(final.status!==200)throw Error('Mandatory password change failed')
  const memberLogin=await request('/auth/login',{username:'reset_qa_member',password:'IsolatedMemberFinal2026!'});if(memberLogin.status!==200||memberLogin.body.data.user.mustChangePassword)throw Error('Member did not exit temporary-password flow')
  await openTarget('reset_qa_admin')
  await evaluate(`(()=>{const fields=document.querySelectorAll('.password-reset-content input[type=password]');[${JSON.stringify(old)},${JSON.stringify(own)},${JSON.stringify(own)}].forEach((value,i)=>{fields[i].value=value;fields[i].dispatchEvent(new Event('input',{bubbles:true}))})})()`)
  await fill('.password-reset-content textarea','隔离管理员本人定期修改密码');await click('.dialog-actions button:last-child');await until(`document.querySelector('.dialog-card')?.textContent.includes('再次确认修改密码')`,'self confirmation');await click('.dialog-actions button:last-child');await until(`location.hash.includes('/login')`,'self reset logout')
  if(await evaluate(`!!(localStorage.getItem('hufe.admin.access-token')||sessionStorage.getItem('hufe.admin.access-token'))`))throw Error('Self reset retained admin login token')
  if((await request('/auth/login',{username:'reset_qa_admin',password:old})).status!==401||(await request('/auth/login',{username:'reset_qa_admin',password:own})).status!==200)throw Error('Self reset credential change not effective')
  const exceptions=events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text)
  const audit=await app.services.audit.list({});if([old,next,own].some(secret=>JSON.stringify(audit).includes(secret)))throw Error('Audit contains a plaintext password')
  console.log(JSON.stringify({isolated:true,memberReset:true,oldPasswordRejected:true,newPasswordAccepted:true,mandatoryChangeCompleted:true,selfResetLoggedOut:true,ordinaryAndDelegatedDenied:true,layout,exceptions,screenshots:['.local-runtime/password-dialog-695.png','.local-runtime/password-dialog-430.png']},null,2));if(exceptions.length)throw Error('Unexpected browser exception')
}finally{
  socket?.close();chrome?.kill('SIGTERM');await vite?.close();await app?.close();await wait(600);await fs.rm(dir,{recursive:true,force:true})
}
