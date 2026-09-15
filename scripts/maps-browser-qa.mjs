import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-map-chrome-'))
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--use-angle=swiftshader','--enable-unsafe-swiftshader',`--user-data-dir=${root}`,'--remote-debugging-port=9499','about:blank'],{stdio:'ignore'})
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let socket
try{
  let tabs;for(let i=0;i<50;i++){try{tabs=await(await fetch('http://127.0.0.1:9499/json/list')).json();if(tabs.length)break}catch{}await wait(100)}
  if(!tabs?.length)throw new Error('Headless Chrome unavailable')
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let serial=0;const pending=new Map(),events=[]
  socket.onmessage=e=>{const p=JSON.parse(e.data);if(p.id){const request=pending.get(p.id);pending.delete(p.id);p.error?request.reject(new Error(JSON.stringify(p.error))):request.resolve(p.result)}else events.push(p)}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
  await send('Page.enable');await send('Network.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1100,height:760,deviceScaleFactor:1,mobile:false})
  const url=process.argv[2]||'http://127.0.0.1:4899/api/v1/maps/viewer/index.html?lon=112.97087&lat=28.19874'
  await send('Page.navigate',{url})
  await wait(18000)
  if(process.env.HUFE_MAP_QA_ZOOM15==='1'){for(let i=0;i<3;i++)await send('Runtime.evaluate',{expression:'document.querySelector(".maplibregl-ctrl-zoom-in").click()'});await wait(7000)}
  if(url.includes('edit=1')){
    const click=async(x,y)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
    for(const [mode,points] of [['Point',[[400,300]]],['LineString',[[500,300],[600,400]]],['Polygon',[[650,220],[750,220],[730,320]]]]){await send('Runtime.evaluate',{expression:`document.querySelector('[data-mode="${mode}"]').click()`});for(const [x,y]of points)await click(x,y);if(mode!=='Point')await send('Runtime.evaluate',{expression:'document.getElementById("finish").click()'})}
    await wait(1000)
  }
  const state=await send('Runtime.evaluate',{expression:'({status:document.getElementById("status")?.textContent,canvas:!!document.querySelector("canvas"),error:document.getElementById("status")?.classList.contains("error"),draw:document.getElementById("draw-status")?.textContent})',returnByValue:true})
  const screenshot=await send('Page.captureScreenshot',{format:'png'})
  const output=path.resolve(url.includes('edit=1')?'.local-runtime/map-drawing-qa.png':'.local-runtime/map-browser-qa.png');await fs.writeFile(output,Buffer.from(screenshot.data,'base64'))
  const requests=events.filter(e=>e.method==='Network.requestWillBeSent').map(e=>e.params.request.url),failures=events.filter(e=>e.method==='Network.responseReceived'&&e.params.response.status>=400).map(e=>({status:e.params.response.status,url:e.params.response.url})),exceptions=events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text)
  console.log(JSON.stringify({state:state.result.value,screenshot:output,requests:requests.length,external:requests.filter(u=>/^https?:/.test(u)&&new URL(u).hostname!=='127.0.0.1'),failures,exceptions},null,2))
  if(state.result.value.error||!state.result.value.canvas||failures.length||exceptions.length)process.exitCode=1
  if(url.includes('edit=1')&&!state.result.value.draw.startsWith('3 个要素'))process.exitCode=1
}finally{socket?.close();chrome.kill('SIGTERM');await wait(1000);await fs.rm(root,{recursive:true,force:true})}
