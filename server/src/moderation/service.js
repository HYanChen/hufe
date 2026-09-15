import { randomUUID } from 'node:crypto'
import { auditRecord } from '../audit/metadata.js'
const fail=(message,code='SENSITIVE_WORD_INVALID',statusCode=400)=>Object.assign(new Error(message),{code,statusCode})
export const normalizeSensitiveText=value=>String(value).normalize('NFKC').toLowerCase().replace(/[\s\p{Cf}]/gu,'')
// Match displayed user text, never protocol enums, UUIDs, passwords or image bytes.
const visibleFields=new Set(['content','text','title','name','filename','caption','description','summary','body','message','reply','note','notes','reason','remark','remarks','comment','feedback','bio','introduction','topic','topics','tags','company','position','requirements','responsibilities','benefits','address','location','city','department','major','className','contactName','availability','email','phone','contact','organizer','industry','businessScope','cooperation','detail','details'])
export class ModerationService{
  constructor(database){this.database=database;this.revision=-1;this.root=new Map()}
  rules(){return this.database.read(d=>({items:d.sensitiveWords||[],revision:Number(d.sensitiveWordsRevision||0)}))}
  assert(body){
    const current=this.rules()
    if(current.revision!==this.revision){this.root=new Map();for(const w of current.items.filter(w=>w.enabled)){let node=this.root;for(const ch of normalizeSensitiveText(w.word)){if(!node.has(ch))node.set(ch,new Map());node=node.get(ch)}node.end=true}this.revision=current.revision}
    if(!this.root.size)return
    let length=0;const values=[]
    const collect=(value,key='',depth=0)=>{
      if(depth>12)throw fail('内容层级过深')
      if(Buffer.isBuffer(value))return
      if(visibleFields.has(key)&&value!==null&&value!==undefined){
        const normalized=String(value);length+=normalized.length
        if(length>150000)throw fail('本次提交的文本过长')
        values.push(normalized)
        // Also inspect common rich-text presentation: emphasis/code markers and
        // Markdown link destinations are not visible between the displayed words.
        values.push(normalized.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*_~`]/g,''))
      }
      if(Array.isArray(value))value.forEach(v=>collect(v,key,depth+1))
      else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>collect(v,k,depth+1))
    }
    collect(body)
    for(const value of values){const chars=[...normalizeSensitiveText(value)];for(let i=0;i<chars.length;i++){let node=this.root;for(let j=i;j<chars.length;j++){node=node.get(chars[j]);if(!node)break;if(node.end)throw fail('内容包含限制用语，请修改后重新提交','CONTENT_SENSITIVE_WORD',422)}}}
  }
  async save(input,metadata,guard){if(!input||!Array.isArray(input.words)||input.words.length<1||input.words.length>500||typeof input.enabled!=='boolean')throw fail('每次可提交1至500个词条');const words=[...new Set(input.words.map(w=>{if(typeof w!=='string'||w.length>60||!normalizeSensitiveText(w))throw fail('词条须为1至60字');return w.trim()}))];return this.database.transaction(d=>{guard(d);d.sensitiveWords||=[];let added=0;for(const word of words){let found=d.sensitiveWords.find(w=>normalizeSensitiveText(w.word)===normalizeSensitiveText(word));if(found){found.enabled=input.enabled;found.updatedAt=new Date().toISOString()}else{if(d.sensitiveWords.length>=10000)throw fail('词库最多10000条');d.sensitiveWords.push({id:randomUUID(),word,enabled:input.enabled,updatedAt:new Date().toISOString()});added++}}d.sensitiveWordsRevision=Number(d.sensitiveWordsRevision||0)+1;d.auditLogs.unshift(auditRecord('moderation.words_saved','sensitive-words',metadata,{count:words.length,added,enabled:input.enabled}));return {added,updated:words.length-added,revision:d.sensitiveWordsRevision}})}
  async toggle(id,input,metadata,guard){if(typeof input?.enabled!=='boolean')throw fail('请选择启用或停用');return this.database.transaction(d=>{guard(d);const row=(d.sensitiveWords||[]).find(w=>w.id===id);if(!row)throw fail('词条不存在','SENSITIVE_WORD_NOT_FOUND',404);row.enabled=input.enabled;row.updatedAt=new Date().toISOString();d.sensitiveWordsRevision=Number(d.sensitiveWordsRevision||0)+1;d.auditLogs.unshift(auditRecord('moderation.word_status_changed',id,metadata,{enabled:input.enabled}));return row})}
}
