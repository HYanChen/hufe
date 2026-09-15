import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
import {hmac,safeEqual} from '../auth/crypto.js'

const normalize=value=>typeof value==='string'?value.replace(/\s+/g,''):''
const valid=value=>/^[A-Za-z0-9_.-]{4,40}$/.test(value)
const key=secret=>createHash('sha256').update('hufe-self-student-number:'+secret).digest()
export function sealStudentNumber(value,secret){
  const number=normalize(value);if(!valid(number))return ''
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv)
  cipher.setAAD(Buffer.from('self-identity-card-v1'))
  const bytes=Buffer.concat([cipher.update(number,'utf8'),cipher.final()])
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.')
}
export function selfStudentNumber(account,secret){
  if(!account)return ''
  let number=''
  if(account.studentIdSealed){try{const [version,iv,tag,body]=String(account.studentIdSealed).split('.');if(version!=='v1')return '';const decipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from('self-identity-card-v1'));decipher.setAuthTag(Buffer.from(tag,'base64url'));number=Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8')}catch{return ''}}
  else number=normalize(account.studentIdDisplay)
  // Legacy full numbers are usable only when they match the verified identity key.
  if(!valid(number)||!account.studentIdKey||!safeEqual(hmac(`student-id:${number}`,secret),account.studentIdKey))return ''
  return number
}
