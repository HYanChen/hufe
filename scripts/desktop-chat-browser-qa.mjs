// Local disposable account fixture only. Never point this script at production.
import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const FRONT='http://127.0.0.1:5273',API='http://127.0.0.1:8879/api/v1',root=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-dock-chrome-'))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${root}`,'--remote-debugging-port=9498','about:blank'],{stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms));let socket,captureFailure
try{
  const login=await(await fetch(API+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'qa_member',password:'Isolated-QA-2026!'})})).json();if(!login.data?.accessToken)throw new Error('Isolated QA login failed')
  let tabs;for(let i=0;i<50;i++){try{tabs=await(await fetch('http://127.0.0.1:9498/json/list')).json();if(tabs.length)break}catch{}await wait(100)}
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let serial=0;const pending=new Map(),events=[];socket.onmessage=e=>{const p=JSON.parse(e.data);if(p.id){const r=pending.get(p.id);pending.delete(p.id);p.error?r.reject(new Error(JSON.stringify(p.error))):r.resolve(p.result)}else events.push(p)}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
  captureFailure=async()=>{console.log(await evaluate(`({body:document.querySelector('#hufe-desktop-chat-root')?.innerText,errors:[...document.querySelectorAll('.chat-error')].map(x=>x.textContent)})`));const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.resolve('.local-runtime/desktop-chat-error.png'),Buffer.from(shot.data,'base64'))}
  const until=async(expression,label)=>{for(let i=0;i<70;i++){if(await evaluate(expression))return;await wait(150)}throw new Error('Timed out: '+label)}
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:FRONT+'/#/'});await until('!!window.uni','uni bootstrap')
  await evaluate(`uni.setStorageSync('hufe_alumni_auth_state',${JSON.stringify({accessToken:login.data.accessToken,tokenType:'Bearer',expiresAt:login.data.expiresAt||''})})`);await send('Page.reload');await until('!!document.querySelector(".desktop-chat-trigger")','dock trigger')
  await evaluate('document.querySelector(".desktop-chat-trigger").click()');await until('document.querySelectorAll("#hufe-desktop-chat-root .conversation-item").length>0','real conversations')
  await until(`!!document.querySelector('#hufe-desktop-chat-root .conversation-inbox')&&!document.querySelector('#hufe-desktop-chat-root .conversation-inbox').textContent.includes('正在加载')`,'pinned notifications')
  const notifications=await(await fetch(API+'/business/me/inbox?page=1&pageSize=1',{headers:{authorization:'Bearer '+login.data.accessToken}})).json();if(notifications.code!==0)throw new Error('QA inbox API failed')
  const pinned=await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-inbox').textContent`)
  if(notifications.data.items?.[0]?.title&&!pinned.includes(notifications.data.items[0].title))throw new Error('Pinned notification is not actual latest item')
  if(await evaluate(`!!document.querySelector('.home-page .announcement-card')`))throw new Error('Home notification card remains')
  const layout=await evaluate(`({url:location.href,tabs:[...document.querySelectorAll('.uni-tabbar__item')].filter(x=>getComputedStyle(x).display!=='none').map(x=>x.querySelector('.uni-tabbar__label')?.textContent.trim()),top:document.querySelector('.desktop-chat-panel').getBoundingClientRect().top,headerVisible:document.querySelector('.desktop-chat-heading').getBoundingClientRect().top>=76,iframes:document.querySelectorAll('#hufe-desktop-chat-root iframe').length})`)
  if(layout.tabs.includes('对话')||!layout.tabs.includes('服务')||!layout.headerVisible||layout.iframes)throw new Error('Desktop layout invariant failed: '+JSON.stringify(layout))
  if(process.env.HUFE_DOCK_QA_GROUP_ONLY==='1')await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-item').click()`)
  else{
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-new').click()`)
  await until('!!document.querySelector("#hufe-desktop-chat-root .conversation-search input")','create direct dialog')
  await evaluate(`(()=>{const el=document.querySelector('#hufe-desktop-chat-root .conversation-search input');el.value='qa_admin';el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-search uni-button').click()`)
  await until('!!document.querySelector("#hufe-desktop-chat-root .conversation-person")','real member search')
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-person').click()`);await wait(100)
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-dialog > uni-button.primary-button').click()`)
  }
  await until('!!document.querySelector("#hufe-desktop-chat-root .chat-input-row textarea")','direct thread')
  const text='PC悬浮窗真实消息验收 '+Date.now()
  await evaluate(`(()=>{const el=document.querySelector('#hufe-desktop-chat-root .chat-input-row textarea');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(100);await evaluate('document.querySelector("#hufe-desktop-chat-root .chat-input-row uni-button").click()')
  await until(`document.querySelector('#hufe-desktop-chat-root .chat-history').textContent.includes(${JSON.stringify(text)})`,'message persisted and reread')
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .chat-tools uni-button').click()`);await until(`!!document.querySelector('#hufe-desktop-chat-root .chat-emoji-grid')`,'emoji picker');await evaluate(`document.querySelector('#hufe-desktop-chat-root .chat-emoji-grid uni-button').click()`)
  await until(`!!document.querySelector('#hufe-desktop-chat-root .chat-input-row textarea').value`,'emoji insertion')
  const emojiDraft=await evaluate(`document.querySelector('#hufe-desktop-chat-root .chat-input-row textarea').value`)
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .desktop-chat-heading uni-button').click()`);await wait(200);if(await evaluate('getComputedStyle(document.querySelector(".desktop-chat-panel")).display')!=='none')throw new Error('Dock did not minimize')
  await evaluate('document.querySelector(".desktop-chat-trigger").click()');await until('!!document.querySelector("#hufe-desktop-chat-root .chat-input-row textarea")','reopen thread');const preserved=await evaluate(`document.querySelector('#hufe-desktop-chat-root .chat-input-row textarea').value`);if(preserved!==emojiDraft)throw new Error('Draft lost when minimizing')
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .chat-input-row uni-button').click()`);await until(`!document.querySelector('#hufe-desktop-chat-root .chat-input-row textarea').value`,'emoji sent')
  await send('Page.setInterceptFileChooserDialog',{enabled:true})
  const upload=async(toolIndex,file,selector)=>{await until(`!document.querySelectorAll('#hufe-desktop-chat-root .chat-tools uni-button')[${toolIndex}].hasAttribute('disabled')`,'attachment tools ready');const before=await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`),start=events.length;await evaluate(`document.querySelectorAll('#hufe-desktop-chat-root .chat-tools uni-button')[${toolIndex}].click()`);let chooser;for(let i=0;i<50;i++){chooser=events.slice(start).find(e=>e.method==='Page.fileChooserOpened');if(chooser)break;await wait(100)}if(!chooser)throw new Error('Native file chooser not opened');await send('DOM.setFileInputFiles',{backendNodeId:chooser.params.backendNodeId,files:[file]});await until(`document.querySelectorAll(${JSON.stringify(selector)}).length>${before}`,'new attachment uploaded and sent');await until(`!document.querySelector('#hufe-desktop-chat-root .chat-upload')`,'attachment task completed')}
  await upload(1,path.resolve('static/tabbar/home-active.png'),'#hufe-desktop-chat-root .chat-photo')
  await upload(2,path.resolve('.local-runtime/desktop-chat-attachment-qa.txt'),'#hufe-desktop-chat-root .chat-file')
  const groupName='悬浮窗验收群 '+Date.now()
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-new').click()`);await until('!!document.querySelector("#hufe-desktop-chat-root .conversation-modes")','group create dialog')
  await evaluate(`document.querySelectorAll('#hufe-desktop-chat-root .conversation-modes uni-button')[1].click()`);await until('!!document.querySelector("#hufe-desktop-chat-root .conversation-input input")','group name input')
  await evaluate(`(()=>{const el=document.querySelector('#hufe-desktop-chat-root .conversation-input input');el.value=${JSON.stringify(groupName)};el.dispatchEvent(new Event('input',{bubbles:true}));const search=document.querySelector('#hufe-desktop-chat-root .conversation-search input');search.value='qa_admin';search.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-search uni-button').click()`);await until('!!document.querySelector("#hufe-desktop-chat-root .conversation-person")','group peer search');await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-person').click()`);await wait(150);await evaluate(`document.querySelector('#hufe-desktop-chat-root .conversation-dialog > uni-button.primary-button').click()`)
  await until(`document.querySelector('#hufe-desktop-chat-root .chat-title')?.textContent===${JSON.stringify(groupName)}`,'created group thread')
  const groupText='PC群聊创建与收发验收 '+Date.now();await evaluate(`(()=>{const el=document.querySelector('#hufe-desktop-chat-root .chat-input-row textarea');el.value=${JSON.stringify(groupText)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(150);await evaluate(`document.querySelector('#hufe-desktop-chat-root .chat-input-row uni-button').click()`);await until(`document.querySelector('#hufe-desktop-chat-root .chat-history').textContent.includes(${JSON.stringify(groupText)})`,'group message persisted')
  const desktopImage=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.resolve('.local-runtime/desktop-chat-qa.png'),Buffer.from(desktopImage.data,'base64'))
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await send('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});await wait(700)
  const mobile=await evaluate(`({dock:!!document.querySelector('.desktop-chat-dock'),tabs:[...document.querySelectorAll('.uni-tabbar__item')].filter(x=>getComputedStyle(x).display!=='none').map(x=>x.querySelector('.uni-tabbar__label')?.textContent.trim())})`)
  if(mobile.dock||!mobile.tabs.includes('对话'))throw new Error('Mobile tab regression: '+JSON.stringify(mobile))
  const mobileImage=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.resolve('.local-runtime/desktop-chat-mobile-qa.png'),Buffer.from(mobileImage.data,'base64'))
  const urlUnchanged=await evaluate('location.href')===layout.url
  await evaluate(`document.querySelector('.uni-tabbar__item[data-hufe-chat-tab]').click()`);await until(`!!document.querySelector('.conversations-page:not(.conversations-page--embedded) .conversation-item')`,'mobile conversation list')
  if(!await evaluate(`!!document.querySelector('.conversations-page:not(.conversations-page--embedded) .conversation-inbox')`))throw new Error('Mobile pinned inbox missing')
await evaluate(`document.querySelector('.conversations-page:not(.conversations-page--embedded) .conversation-inbox').click()`);await until(`location.hash.includes('/pages/inbox/index')`,'actual notification page navigation');await until(`!!document.querySelector('.inbox-page')`,'notification content loaded');await wait(600);await evaluate(`uni.navigateBack()`);await until(`!!document.querySelector('.conversations-page:not(.conversations-page--embedded) .conversation-item')`,'return to conversation list')
  await evaluate(`document.querySelector('.conversations-page:not(.conversations-page--embedded) .conversation-item').click()`);await until(`!!document.querySelector('.chat-page:not(.chat-page--embedded) .chat-input-row textarea')`,'mobile shared chat thread')
  const phoneThread=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.resolve('.local-runtime/desktop-chat-mobile-thread-qa.png'),Buffer.from(phoneThread.data,'base64'))
  const exceptions=events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text)
  console.log(JSON.stringify({mode:process.env.HUFE_DOCK_QA_GROUP_ONLY==='1'?'existing-school-group':'new-direct-chat',layout,mobile,sentText:true,emojiDraftPreserved:true,imageUploaded:true,fileUploaded:true,groupCreated:true,groupMessageSent:true,urlUnchanged,mobileChatLoaded:true,exceptions,screenshots:['.local-runtime/desktop-chat-qa.png','.local-runtime/desktop-chat-mobile-qa.png','.local-runtime/desktop-chat-mobile-thread-qa.png']},null,2));if(exceptions.length)process.exitCode=1
}catch(error){await captureFailure?.().catch(()=>{});throw error}finally{socket?.close();chrome.kill('SIGTERM');await wait(800);await fs.rm(root,{recursive:true,force:true})}
