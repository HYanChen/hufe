import {inflateRawSync} from 'node:zlib'
import path from 'node:path'
import {XMLParser, XMLValidator} from 'fast-xml-parser'

export const personnelColumns = Object.freeze({用户名:'username',姓名:'name',身份类型:'personType','学院/部门':'department',专业:'major',班级:'className','学号/工号':'studentId',入学年份:'enrollmentYear',毕业年份:'graduationYear',预计毕业年份:'expectedGraduationYear'})
export const XLSX_BYTES = 5 * 1024 * 1024
const MAX_EXPANDED = 20 * 1024 * 1024
const fail = message => Object.assign(new Error(message), {code:'PERSONNEL_XLSX_INVALID',statusCode:400})
const array = value => value == null ? [] : Array.isArray(value) ? value : [value]
const crcTable = Array.from({length:256}, (_, n) => {for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
export function crc32(buffer){let result=0xffffffff;for(const byte of buffer)result=crcTable[(result^byte)&255]^(result>>>8);return (result^0xffffffff)>>>0}

export function readXlsxZip(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>XLSX_BYTES)throw fail('请选择5MB以内的.xlsx文件')
  let end=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break}
  if(end<0)throw fail('Excel文件不完整或并非.xlsx格式')
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16)
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||!count||count>200||offset+size!==end)throw fail('不支持分卷、ZIP64或超过200个内部文件的Excel')
  const files=new Map(),ranges=[];let cursor=offset,total=0
  for(let entry=0;entry<count;entry++){
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)throw fail('Excel文件索引损坏')
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42)
    const next=cursor+46+nameLength+extraLength+commentLength
    if(next>end||flags&1||![0,8].includes(method)||bytes.readUInt16LE(cursor+34)||((bytes.readUInt32LE(cursor+38)>>>16)&0xf000)===0xa000)throw fail('不支持加密、链接或特殊压缩的Excel文件')
    const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8')
    if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||files.has(name)||/vbaProject|externalLinks|activeX|embeddings|\.bin$/i.test(name))throw fail('Excel包含重复、外部链接、宏或不安全的内部文件')
    total+=expanded
    if(total>MAX_EXPANDED||expanded>10*1024*1024||compressed>XLSX_BYTES||expanded>Math.max(1024*1024,compressed*200))throw fail('Excel解压后过大，请删除多余工作表和空白格式行')
    if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)!==flags)throw fail('Excel内部文件头不一致')
    const localNameLength=bytes.readUInt16LE(local+26),localExtraLength=bytes.readUInt16LE(local+28),start=local+30+localNameLength+localExtraLength,finish=start+compressed
    if(finish>offset||bytes.subarray(local+30,local+30+localNameLength).toString('utf8')!==name||ranges.some(([a,b])=>local<b&&finish>a))throw fail('Excel内部文件范围无效')
    ranges.push([local,finish])
    let content
    try{content=method===0?bytes.subarray(start,finish):inflateRawSync(bytes.subarray(start,finish),{maxOutputLength:Math.min(expanded+1,MAX_EXPANDED)})}catch{throw fail('Excel解压失败或内容超过安全大小')}
    if(content.length!==expanded||crc32(content)!==crc)throw fail('Excel文件校验失败，请重新保存或上传原文件')
    files.set(name,content);cursor=next
  }
  if(cursor!==end)throw fail('Excel索引长度不正确')
  return files
}
function xml(files,name,required=true){
  const bytes=files.get(name)
  if(!bytes){if(!required)return null;throw fail(`Excel缺少必要内容：${name}`)}
  const source=bytes.toString('utf8')
  if(/<!DOCTYPE|<!ENTITY/i.test(source)||XMLValidator.validate(source)!==true)throw fail('Excel XML内容无效或包含不支持的实体定义')
  return new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,removeNSPrefix:true}).parse(source)
}
function text(value){
  if(value==null)return ''
  if(typeof value==='string'||typeof value==='number')return String(value)
  if(Array.isArray(value))return value.map(text).join('')
  if(Object.hasOwn(value,'t'))return text(value.t)
  if(Object.hasOwn(value,'r'))return text(value.r)
  return text(value['#text'])
}
export function parsePersonnelWorkbook(bytes){
  const files=readXlsxZip(bytes)
  for(const [name,content] of files){if(/\.rels$/.test(name)&&/TargetMode\s*=\s*["']External["']/i.test(content.toString('utf8')))throw fail('不支持含外部链接的Excel文件');if(/\.xml$/.test(name)&&/<!DOCTYPE|<!ENTITY/i.test(content.toString('utf8')))throw fail('不支持含实体定义的Excel文件')}
  const types=xml(files,'[Content_Types].xml')
  if(JSON.stringify(types).includes('macroEnabled'))throw fail('不支持宏工作簿，请使用普通.xlsx文件')
  const workbook=xml(files,'xl/workbook.xml'),relationships=xml(files,'xl/_rels/workbook.xml.rels')
  const sheets=array(workbook?.workbook?.sheets?.sheet),sheet=sheets.find(s=>s['@_name']==='人员导入')
  if(!sheet||sheets.filter(s=>s['@_name']==='人员导入').length!==1)throw fail('请使用模板，并保留名为“人员导入”的工作表')
  const relation=array(relationships?.Relationships?.Relationship).find(r=>r['@_Id']===(sheet['@_id']||sheet['@_r:id']))
  if(!relation||!String(relation['@_Type']).endsWith('/worksheet'))throw fail('人员导入工作表关联无效')
  const target=String(relation['@_Target']||''),sheetPath=path.posix.normalize(target.startsWith('/')?target.slice(1):'xl/'+target)
  if(!/^xl\/worksheets\/[^/]+\.xml$/.test(sheetPath))throw fail('工作表文件路径无效')
  const strings=array(xml(files,'xl/sharedStrings.xml',false)?.sst?.si).map(text)
  const raw=files.get(sheetPath)?.toString('utf8')||''
  if(/<(?:\w+:)?f(?:\s|>)/.test(raw))throw fail('人员导入表含公式，请先粘贴为值再导入')
  const rows=array(xml(files,sheetPath)?.worksheet?.sheetData?.row),seen=new Set(),parsed=[]
  for(const row of rows){
    const rowNumber=Number(row['@_r'])
    if(!Number.isInteger(rowNumber)||rowNumber<1||rowNumber>1001||seen.has(rowNumber))throw fail('人员导入表最多1000行数据，且行号不能重复')
    seen.add(rowNumber)
    const values=[],kinds=[],columns=new Set()
    for(const cell of array(row.c)){
      const match=String(cell['@_r']||'').match(/^([A-Z]{1,3})(\d+)$/)
      if(!match||Number(match[2])!==rowNumber)throw fail(`第${rowNumber}行的单元格位置无效`)
      const column=[...match[1]].reduce((sum,letter)=>sum*26+letter.charCodeAt(0)-64,0)-1
      if(column>=10||columns.has(column))throw fail(`第${rowNumber}行包含模板以外的列或重复单元格`)
      columns.add(column)
      const kind=cell['@_t']||'n';let value
      if(kind==='s'){const index=Number(cell.v);if(!Number.isInteger(index)||index<0||index>=strings.length)throw fail(`第${rowNumber}行的文本引用无效`);value=strings[index]}
      else if(kind==='inlineStr')value=text(cell.is)
      else if(['n','str'].includes(kind))value=text(cell.v)
      else throw fail(`第${rowNumber}行含日期、布尔值或错误单元格，请改为文本`)
      if(value.length>500)throw fail(`第${rowNumber}行单元格内容过长`)
      values[column]=value.trim();kinds[column]=kind
    }
    parsed.push({rowNumber,values,kinds})
  }
  const header=parsed.find(row=>row.rowNumber===1),names=Object.keys(personnelColumns)
  if(!header||names.some((name,index)=>header.values[index]!==name))throw fail('模板列名或顺序不正确，请下载最新模板，不要修改第一行')
  const data=parsed.filter(row=>row.rowNumber!==1&&row.values.some(Boolean)).sort((a,b)=>a.rowNumber-b.rowNumber)
  if(!data.length)throw fail('人员导入表没有数据，请从第二行开始填写')
  return data.map(row=>({rowNumber:row.rowNumber,input:Object.fromEntries(names.map((name,index)=>[personnelColumns[name],row.values[index]||''])),errors:[0,6].filter(i=>row.values[i]&&row.kinds[i]==='n').map(i=>`${names[i]}必须按文本填写，以免丢失前导零或数字精度`)}))
}
