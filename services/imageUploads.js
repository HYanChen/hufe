import {appConfig} from '../config/index'
import {getAccessToken} from '../utils/store'
const tasks=new WeakMap()
export async function uploadImageRequest(options,request){
  const file=options.data.fileSource,token=options.token===undefined?getAccessToken():options.token,originalSession=getAccessToken()
  const same=()=>{if(originalSession!==getAccessToken())throw Error('登录账号已变化，请重新选择图片')}
  const size=Number(file.size);if(!size||size>500*1024*1024)throw Error('单张图片须在500MB以内')
  const metadata={...options.data};delete metadata.fileSource;delete metadata.dataBase64
  const target=options.path,method=options.method||'POST',key=target+'|'+method+'|'+token
  const control=(path,method='GET',data)=>{same();return request({path,method,data,token,timeout:120000})}
  let cached=tasks.get(file);let task
  try{
    if(cached?.key===key){try{task=await control('/api/v1/image-uploads/'+cached.id)}catch(e){if(e.statusCode!==404)throw e}}
    if(!task){task=await control('/api/v1/image-uploads','POST',{target,method,filename:metadata.filename,mimeType:metadata.mimeType,size});tasks.set(file,{key,id:task.id})}
    same();const received=new Set(task.received)
    for(let i=0;i<task.parts&&task.state==='uploading';i++){
      same();if(received.has(i))continue
      const start=i*task.chunkSize,length=Math.min(task.chunkSize,size-start)
      let bytes
      // #ifdef H5
      bytes=await file.slice(start,start+length).arrayBuffer()
      // #endif
      // #ifndef H5
      if(typeof uni.getFileSystemManager!=='function')throw Error('当前客户端不支持大图片分片读取，请使用网页版上传')
      bytes=await new Promise((resolve,reject)=>uni.getFileSystemManager().readFile({filePath:file.path,position:start,length,success:r=>resolve(r.data),fail:reject}))
      // #endif
      same();let sent=false
      for(let attempt=0;attempt<3&&!sent;attempt++){
        try{await new Promise((resolve,reject)=>uni.request({url:appConfig.apiBaseUrl+'/api/v1/image-uploads/'+task.id+'/chunks/'+i,method:'PUT',data:bytes,timeout:120000,header:{authorization:'Bearer '+token,'content-type':'application/octet-stream'},success:r=>r.statusCode>=200&&r.statusCode<300?resolve(r.data):reject(Object.assign(Error(r.data?.message||'图片分片上传失败'),{statusCode:r.statusCode})),fail:()=>reject(Error('网络中断，请重试继续上传'))}));same();sent=true}catch(e){same();if(attempt===2||(e.statusCode&&e.statusCode<500&&e.statusCode!==429))throw e;await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)))}
      }
      const percent=Math.round((i+1)/task.parts*100);uni.showLoading({title:`上传照片 ${percent}%`,mask:true})
    }
    await control('/api/v1/image-uploads/'+task.id+'/complete','POST',{});same()
    const result=await request({...options,token,data:{...metadata,uploadId:task.id}});same();return result
  }finally{uni.hideLoading()}
}
