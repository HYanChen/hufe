import fs from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import {detectedMimeType} from '../media/service.js'
import {DEFAULT_CERTIFICATE_TEMPLATE} from './giving-template-defaults.js'

const fail = (message, code='GIVING_TEMPLATE_INVALID', statusCode=400) => Object.assign(new Error(message), {code,statusCode})
const textFields = {title:60,subtitle:120,message:800,issuer:120,signature:120}
const colors = ['primaryColor','accentColor','paperColor']
const allowedFields = Object.keys(DEFAULT_CERTIFICATE_TEMPLATE)
const assetPattern = /^\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif))$/i

export function validateGivingTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key=>!allowedFields.includes(key))
    || allowedFields.some(key=>!Object.hasOwn(input,key))) throw fail('请完整提交证书模板，不支持额外字段')
  if (input.schemaVersion !== 1) throw fail('证书模板版本不受支持')
  const template = {schemaVersion:1}
  for (const [key,max] of Object.entries(textFields)) {
    if (typeof input[key] !== 'string' || input[key].length > max
      || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input[key])) throw fail('证书文字须为符合长度限制的纯文本')
    template[key] = input[key].trim().replace(/\r\n?/g,'\n')
  }
  if (['title','message','issuer'].some(key=>!template[key])) throw fail('请填写证书标题、感谢词和签发单位')
  if (/[{}]/.test(template.message.replace(/\{(?:recipientName|projectTitle|amount|donatedAt)\}/g,''))) throw fail('感谢词仅支持姓名、公益项目、金额、捐赠日期四种变量')
  for (const key of colors) {
    if (typeof input[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input[key])) throw fail('配色必须是 #RRGGBB 格式的六位颜色')
    template[key] = input[key].toUpperCase()
  }
  if (!['classic','modern'].includes(input.layout)) throw fail('证书版式仅支持 classic 或 modern')
  if (typeof input.backgroundUrl !== 'string' || input.backgroundUrl !== '' && !assetPattern.test(input.backgroundUrl)) throw fail('背景图只允许已上传到本站的公开图片','GIVING_TEMPLATE_BACKGROUND_INVALID')
  return {...template,backgroundUrl:input.backgroundUrl,layout:input.layout}
}

export async function verifyGivingBackground(template, mediaDirectory) {
  if (!template.backgroundUrl) return
  const filename = assetPattern.exec(template.backgroundUrl)?.[1]
  if (!filename || !mediaDirectory) throw fail('证书背景图不可用','GIVING_TEMPLATE_BACKGROUND_INVALID')
  let handle
  try {
    // Open only the managed public image itself, never a symbolic link or private material.
    handle = await fs.open(path.join(mediaDirectory,filename),constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || !stat.size || stat.size > 500*1024*1024) throw fail('证书背景图不是有效图片','GIVING_TEMPLATE_BACKGROUND_INVALID')
    const header = Buffer.alloc(12)
    const {bytesRead} = await handle.read(header,0,12,0)
    const expected = {jpg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'}[path.extname(filename).slice(1).toLowerCase()]
    if (detectedMimeType(header.subarray(0,bytesRead)) !== expected) throw fail('证书背景图格式与文件类型不符','GIVING_TEMPLATE_BACKGROUND_INVALID')
  } catch(error) {
    if (error.code === 'GIVING_TEMPLATE_BACKGROUND_INVALID') throw error
    if (['ENOENT','ENOTDIR','ELOOP'].includes(error.code)) throw fail('背景图片不存在或不可用，请重新上传','GIVING_TEMPLATE_BACKGROUND_INVALID')
    throw error
  } finally { await handle?.close() }
}

export function givingTemplateSnapshot(project, certificateInput) {
  if (project?.certificateTemplate) return validateGivingTemplate(project.certificateTemplate)
  return {...DEFAULT_CERTIFICATE_TEMPLATE,title:certificateInput.title,issuer:'湖南财政经济学院'}
}
