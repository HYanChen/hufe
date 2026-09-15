const tasks=new WeakMap()
export async function uploadImageRequest(path,options,{api,apiUrl,accessToken}){
  const token=options.token===undefined?accessToken():options.token,session=accessToken(),file=options.body.fileSource
  const same=()=>{if(session!==accessToken())throw Error('登录账号已变化，请重新选择图片')}
  if(!(file instanceof Blob)||!file.size||file.size>500*1024*1024)throw Error('单张图片须在500MB以内')
  const metadata={...options.body};delete metadata.fileSource;delete metadata.dataBase64
  const method=options.method||'POST',target=new URL(apiUrl(path)).pathname,key=target+'|'+method+'|'+token
  const control=(path,method='GET',body)=>{same();return api(path,{method,body,token})}
  try{
    let task,cached=tasks.get(file)
    if(cached?.key===key){try{task=await control('/image-uploads/'+cached.id)}catch(e){if(e.status!==404)throw e}}
    if(!task){task=await control('/image-uploads','POST',{target,method,size:file.size,mimeType:file.type,filename:file.name});tasks.set(file,{key,id:task.id})}
    same();const received=new Set(task.received)
    for(let i=0;i<task.parts&&task.state==='uploading';i++){
      same();if(received.has(i))continue
      const bytes=file.slice(i*task.chunkSize,Math.min(file.size,(i+1)*task.chunkSize));let sent=false
      for(let attempt=0;attempt<3&&!sent;attempt++){same();try{const r=await fetch(apiUrl('/image-uploads/'+task.id+'/chunks/'+i),{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/octet-stream'},body:bytes,signal:options.signal});const body=await r.json();same();if(!r.ok)throw Object.assign(Error(body.message||'图片上传失败'),{status:r.status});sent=true}catch(e){same();if(attempt===2||e.name==='AbortError'||e.status&&e.status<500&&e.status!==429)throw e;await new Promise(r=>setTimeout(r,700*(attempt+1)))}}
      window.dispatchEvent(new CustomEvent('hufe:image-progress',{detail:{name:file.name,percent:Math.round((i+1)/task.parts*100)}}))
    }
    await control('/image-uploads/'+task.id+'/complete','POST',{});same()
    return await api(path,{...options,token,body:{...metadata,uploadId:task.id}})
  }finally{window.dispatchEvent(new CustomEvent('hufe:image-progress',{detail:null}))}
}
