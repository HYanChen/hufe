import { request } from './http'
import { appConfig } from '../config/index'
import { getAccessToken } from '../utils/store'
export const chatApi=(path='',options={})=>request({path:'/api/v1/chat'+path,...options})
export const chatUrl=path=>appConfig.apiBaseUrl+path
export const messageId=()=>`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
export function fileSize(size){if(size<1024)return size+' B';const unit=Math.min(3,Math.floor(Math.log(size)/Math.log(1024)));return (size/1024**unit).toFixed(1)+' '+['B','KB','MB','GB'][unit]}
export function pickChatFile(images=false){
  // #ifdef H5
  return new Promise(resolve=>{const input=document.createElement('input');input.type='file';if(images)input.accept='image/png,image/jpeg,image/webp,image/gif';input.onchange=()=>resolve(input.files?.[0]||null);input.oncancel=()=>resolve(null);input.click()})
  // #endif
  // #ifndef H5
  return Promise.reject(new Error('大文件上传请在电脑或手机浏览器中打开湖财人；小程序文件能力尚待真机验收'))
  // #endif
}
export async function uploadChatFile(file,conversationId,{onProgress=()=>{},signal,existingId=''}={}){
  const token=getAccessToken(),same=()=>{if(signal?.aborted)throw new Error('上传已暂停，可重新选择原文件续传');if(token!==getAccessToken())throw new Error('登录账号已变化，请重新进入对话')}
  if(file.size>5*1024**3||file.size<1)throw new Error('单文件大小须在1字节至5GB之间')
  same();const task=existingId?await chatApi('/uploads/'+existingId,{token}):await chatApi('/conversations/'+conversationId+'/uploads',{method:'POST',token,data:{name:file.name,size:file.size}});same()
  if(task.name!==file.name||task.size!==file.size||task.conversationId!==conversationId)throw new Error('请选择原文件继续上传')
  onProgress({id:task.id,percent:0,name:file.name,size:file.size})
  if(['ready','bound'].includes(task.status))return task
  const bytesHex=bytes=>Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('')
  for(let index=0;index<task.parts;index++){
    same();const part=await file.slice(index*task.chunkSize,Math.min(file.size,(index+1)*task.chunkSize)).arrayBuffer();same()
    const digest=bytesHex(await crypto.subtle.digest('SHA-256',part));same()
    if(task.received?.[index]){if(task.received[index]!==digest)throw new Error('文件内容与之前不同，请取消旧任务后重新上传')}
    else {let completed=false;for(let attempt=0;attempt<3&&!completed;attempt++){same();let response;try{response=await fetch(chatUrl('/api/v1/chat/uploads/'+task.id+'/chunks/'+index),{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/octet-stream'},body:part,signal});const body=await response.json();same();if(!response.ok){if(response.status===429&&attempt<2){await new Promise(r=>setTimeout(r,1500));continue}throw new Error(body.message||'分片上传失败')}if(body.data.sha256!==digest)throw new Error('分片校验失败');completed=true}catch(e){same();if(attempt===2||response?.status&&response.status<500&&response.status!==429)throw e;await new Promise(r=>setTimeout(r,1000))}}}
    onProgress({id:task.id,percent:Math.round(Math.min(file.size,(index+1)*task.chunkSize)/file.size*100),name:file.name,size:file.size})
  }
  same();const result=await chatApi('/uploads/'+task.id+'/complete',{method:'POST',token});same();return result
}
export async function chatFileLink(id,token=getAccessToken()){const result=await chatApi('/files/'+id+'/ticket',{method:'POST',token});if(token!==getAccessToken())throw new Error('登录账号已变化，请重新进入对话');return chatUrl(result.url)}
export function downloadChatFile(url){
  // #ifdef H5
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.click();return
  // #endif
  // #ifndef H5
  uni.showModal({title:'文件下载',content:'请在浏览器中打开湖财人下载附件',showCancel:false})
  // #endif
}
