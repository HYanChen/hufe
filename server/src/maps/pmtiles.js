import fs from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'

export const mapError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,code:'MAP_INVALID'})
export async function sha256File(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
const decode=(buffer,compression,limit)=>compression===1?buffer:compression===2?gunzipSync(buffer,{maxOutputLength:limit}):(()=>{throw mapError('仅支持无压缩或 GZIP 内部索引的 PMTiles v3 文件')})()
function directory(buffer,header){
  let position=0
  function integer(){let value=0,multiple=1;for(let i=0;i<8;i++){if(position>=buffer.length)throw mapError('地图索引截断');const byte=buffer[position++];value+=(byte&127)*multiple;if(!Number.isSafeInteger(value))throw mapError('地图索引整数越界');if(!(byte&128))return value;multiple*=128}throw mapError('地图索引无效')}
  const count=integer();if(!count||count>100000)throw mapError('地图根索引数量无效')
  const rows=Array.from({length:count},()=>({}));let tile=0
  for(const row of rows){tile+=integer();row.tile=tile}
  for(const row of rows)row.run=integer()
  for(const row of rows)row.length=integer()
  for(let i=0;i<rows.length;i++){const value=integer(),row=rows[i];row.offset=value?value-1:i?rows[i-1].offset+rows[i-1].length:NaN;if(!row.length||!Number.isSafeInteger(row.offset)||row.offset<0||row.offset+row.length>(row.run?header.tileLength:header.leafLength))throw mapError('地图索引指向文件边界之外')}
  if(position!==buffer.length)throw mapError('地图根索引存在多余数据')
}
export async function inspectPmtiles(file,{expectedSha}={}){
  const handle=await fs.open(file,'r')
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size<127)throw mapError('地图文件不是有效 PMTiles')
    const buffer=Buffer.alloc(127);await handle.read(buffer,0,127,0)
    if(buffer.subarray(0,7).toString()!=='PMTiles'||buffer[7]!==3)throw mapError('请上传 PMTiles v3 矢量地图文件')
    const number=offset=>{const n=Number(buffer.readBigUInt64LE(offset));if(!Number.isSafeInteger(n))throw mapError('地图文件长度越界');return n}
    const header={rootOffset:number(8),rootLength:number(16),metadataOffset:number(24),metadataLength:number(32),leafOffset:number(40),leafLength:number(48),tileOffset:number(56),tileLength:number(64)}
    if(buffer[99]!==1||![1,2].includes(buffer[97])||![1,2].includes(buffer[98]))throw mapError('仅支持 MVT 矢量底图和无压缩/GZIP 数据')
    const sections=[[header.rootOffset,header.rootLength],[header.metadataOffset,header.metadataLength],[header.leafOffset,header.leafLength],[header.tileOffset,header.tileLength]].filter(row=>row[1]>0).sort((a,b)=>a[0]-b[0])
    let end=127;for(const [offset,length] of sections){if(offset<end||offset+length>stat.size)throw mapError('地图数据分区重叠或超出文件');end=offset+length}
    if(!header.rootLength||header.rootOffset+header.rootLength>16384||!header.metadataLength||header.metadataLength>2*1024*1024||!header.tileLength)throw mapError('地图索引或元数据不完整')
    const bounds=[102,106,110,114].map(offset=>buffer.readInt32LE(offset)/1e7)
    if(bounds.some(v=>!Number.isFinite(v))||bounds[0]<-180||bounds[2]>180||bounds[1]<-85.051129||bounds[3]>85.051129||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||buffer[100]>buffer[101]||buffer[101]>24)throw mapError('地图经纬度范围或缩放级别不正确')
    async function read(offset,length){const result=Buffer.alloc(length);const {bytesRead}=await handle.read(result,0,length,offset);if(bytesRead!==length)throw mapError('地图文件截断');return result}
    directory(decode(await read(header.rootOffset,header.rootLength),buffer[97],4*1024*1024),header)
    let metadata;try{metadata=JSON.parse(decode(await read(header.metadataOffset,header.metadataLength),buffer[97],4*1024*1024).toString())}catch{throw mapError('地图元数据 JSON 无效')}
    const layers=metadata?.vector_layers?.map(layer=>layer.id)
    if(!Array.isArray(layers)||!['earth','water','roads','places'].every(layer=>layers.includes(layer)))throw mapError('底图须采用 Protomaps v4 兼容层结构（earth、water、roads、places）')
    const sha256=await sha256File(file);if(expectedSha&&sha256!==expectedSha)throw mapError('地图 SHA256 校验不匹配，请重新上传正确文件')
    return {size:stat.size,sha256,bounds,minZoom:buffer[100],maxZoom:buffer[101],layers,format:'PMTiles v3 / Protomaps v4'}
  }finally{await handle.close()}
}

export function parseByteRange(value,size){
  if(!value)return null
  const match=/^bytes=(\d*)-(\d*)$/.exec(value)
  if(!match||(!match[1]&&!match[2]))throw mapError('不支持的字节范围',416)
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[2]&&match[1]?Math.min(size-1,Number(match[2])):size-1
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw mapError('字节范围超出文件',416)
  return {start,end}
}
