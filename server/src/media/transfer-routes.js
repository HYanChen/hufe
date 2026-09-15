import {PHOTO_CHUNK_BYTES} from './transfers.js'
const data=value=>({code:0,message:'ok',data:value})
export async function imageTransferRoutes(app,{transfers,authorize}){
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:PHOTO_CHUNK_BYTES},(_r,body,done)=>done(null,body))
  let inFlight=0
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    if(request.params.id){const row=transfers.row(request.params.id);request.imageOwner=authorize(request,row.target,row.method);transfers.owned(row.id,request.imageOwner)}
    if(request.method==='PUT'){
      if(inFlight>=4)throw Object.assign(new Error('图片上传繁忙，请稍后重试'),{statusCode:429,code:'IMAGE_BUSY'})
      inFlight++;request.imageChunkReserved=true
      const disconnected=()=>{if(!request.raw.complete&&!request.imageProcessing)release(request)}
      request.raw.once('aborted',disconnected);reply.raw.once('close',disconnected)
      request.imageTimeout=setTimeout(()=>{disconnected();request.raw.destroy()},120000);request.imageTimeout.unref()
    }
  })
  function release(r){clearTimeout(r.imageTimeout);if(r.imageChunkReserved){r.imageChunkReserved=false;inFlight--}}
  app.addHook('onResponse',async r=>release(r));app.addHook('onTimeout',async r=>release(r))
  app.post('/api/v1/image-uploads',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async r=>{const b=r.body||{},owner=authorize(r,b.target,b.method||'POST');return data(await transfers.start(owner,b))})
  app.get('/api/v1/image-uploads/:id',r=>data(transfers.view(transfers.owned(r.params.id,r.imageOwner))))
  app.put('/api/v1/image-uploads/:id/chunks/:index',{bodyLimit:PHOTO_CHUNK_BYTES,config:{rateLimit:{max:1000,timeWindow:'1 minute'}}},async r=>{r.imageProcessing=true;try{return data(await transfers.part(r.params.id,r.imageOwner,Number(r.params.index),r.body))}finally{release(r)}})
  app.post('/api/v1/image-uploads/:id/complete',async r=>data(await transfers.complete(r.params.id,r.imageOwner)))
  app.delete('/api/v1/image-uploads/:id',async r=>data(await transfers.cancel(r.params.id,r.imageOwner)))
}
