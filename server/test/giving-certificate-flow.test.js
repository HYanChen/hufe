import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import {DEFAULT_CERTIFICATE_TEMPLATE} from '../src/business/giving-template-defaults.js'
import {validateGivingTemplate,verifyGivingBackground} from '../src/business/giving-template.js'

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {},
    startScheduler() {},
    stopScheduler() {},
    status: () => status,
    home: () => ({ status, sections: {} }),
    list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null,
    refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-giving-certificate-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    dataHashSecret: 'giving-certificate-flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  t.after(async () => {
    await app.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const register = (subject, username, name, options = {}) => app.services.accounts.register({
    schoolSubject: subject,
    name,
    personType: options.personType || 'alumni',
    department: options.department || '财政金融学院',
    verificationSource: 'school-registration-check',
    isAdmin: Boolean(options.isAdmin)
  }, { username, password: 'StrongPass!2026' })

  const admin = await register('giving-admin', 'giving_admin', '公益管理员', {
    isAdmin: true,
    personType: 'staff',
    department: '校友工作办公室'
  })
  const user = await register('giving-user', 'giving_user', '捐赠校友甲')
  await register('giving-other', 'giving_other', '其他校友')

  const login = async (username) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'StrongPass!2026' }
    })
    assert.equal(response.statusCode, 200)
    return { authorization: `Bearer ${response.json().data.accessToken}` }
  }

  return {
    app,
    config,
    accounts: { admin, user },
    headers: {
      admin: await login('giving_admin'),
      user: await login('giving_user'),
      other: await login('giving_other')
    }
  }
}

const templatePayload = (revision,overrides={}) => ({expectedRevision:revision,certificateTemplate:{...DEFAULT_CERTIFICATE_TEMPLATE,...overrides}})
const saveTemplate = (app,headers,id,payload) => app.inject({method:'POST',url:`/api/v1/admin/business/giving-projects/${id}/certificate-template`,headers,payload})

test('项目专属模板真实保存和签发快照，编辑仅影响新证书且并发预览必须重新确认',async t=>{
  const {app,headers}=await fixture(t)
  const project=await createGivingProject(app,headers.admin)
  const current=(await app.inject({method:'GET',url:`/api/v1/admin/business/giving-projects/${project.id}`,headers:headers.admin})).json().data
  const uploaded=await app.services.media.save({mimeType:'image/png',filename:'certificate.png',dataBase64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')})
  const designed={title:'成长计划感谢证书',subtitle:'感谢每一份善意',message:'感谢{recipientName}于{donatedAt}为{projectTitle}捐赠{amount}元。',issuer:'湖南财政经济学院校友工作办公室',signature:'公益项目工作组',primaryColor:'#112233',accentColor:'#aabbcc',paperColor:'#fefefe',backgroundUrl:uploaded.url,layout:'modern'}
  const saved=await saveTemplate(app,headers.admin,project.id,templatePayload(current.revision,designed))
  assert.equal(saved.statusCode,200,saved.body)
  assert.match(saved.headers['cache-control'],/no-store/)
  const expectedTemplate={...DEFAULT_CERTIFICATE_TEMPLATE,...designed,accentColor:'#AABBCC',paperColor:'#FEFEFE'}
  assert.deepEqual(saved.json().data.certificateTemplate,expectedTemplate)
  assert.equal(saved.json().data.revision,current.revision+1)
  const first=await submitGivingIntent(app,headers.user,project.id,{certificateTemplate:{title:'forged'},templateSnapshot:{title:'forged'},certificateProjectRevision:999,expectedProjectRevision:999})
  for (const key of ['certificateTemplate','templateSnapshot','certificateProjectRevision','expectedProjectRevision']) assert.equal(first.payload[key],undefined)
  const preview=(await app.inject({method:'GET',url:`/api/v1/admin/business/applications/${first.id}`,headers:headers.admin})).json().data
  assert.deepEqual(preview.certificateTemplate,expectedTemplate)
  assert.equal(preview.certificateProjectRevision,saved.json().data.revision)
  const issue=async(id,receipt,revision)=>app.inject({method:'POST',url:`/api/v1/admin/business/applications/${id}/actions`,headers:headers.admin,payload:{action:'issue_certificate',confirmedAmount:120.25,donatedAt:'2026-09-13',officialReceiptNo:receipt,title:'不能覆盖已保存模板标题',expectedProjectRevision:revision}})
  assert.equal((await issue(first.id,'TEMPLATE-FIRST',current.revision)).json().code,'GIVING_TEMPLATE_REVISION_CONFLICT')
  const issued=await issue(first.id,'TEMPLATE-FIRST',preview.certificateProjectRevision)
  assert.equal(issued.statusCode,200,issued.body)
  const firstCertificate=issued.json().data.certificate
  assert.deepEqual(firstCertificate.templateSnapshot,expectedTemplate)
  assert.equal(firstCertificate.title,designed.title)
  assert.equal(firstCertificate.issuer,designed.issuer)
  const edited=await saveTemplate(app,headers.admin,project.id,templatePayload(preview.certificateProjectRevision,{...designed,title:'第二版感谢证书'}))
  assert.equal(edited.statusCode,200,edited.body)
  const second=await submitGivingIntent(app,headers.user,project.id)
  assert.equal((await issue(second.id,'TEMPLATE-SECOND',preview.certificateProjectRevision)).json().code,'GIVING_TEMPLATE_REVISION_CONFLICT')
  const nextIssued=await issue(second.id,'TEMPLATE-SECOND',edited.json().data.revision)
  assert.equal(nextIssued.statusCode,200,nextIssued.body)
  assert.equal(nextIssued.json().data.certificate.templateSnapshot.title,'第二版感谢证书')
  const mine=(await app.inject({method:'GET',url:'/api/v1/business/me/submissions?type=giving-intent',headers:headers.user})).json().data
  assert.deepEqual(mine.items.find(item=>item.id===first.id).certificate,firstCertificate)
  const other=(await app.inject({method:'GET',url:'/api/v1/business/me/submissions?type=giving-intent',headers:headers.other})).json().data
  assert.equal(JSON.stringify(other).includes(firstCertificate.certificateNo),false)
  const audit=app.services.database.read(state=>state.auditLogs)
  assert.equal(audit.filter(item=>item.action==='business.giving_template_updated'&&item.targetId===project.id).length,2)
  assert.equal(audit.find(item=>item.action==='business.giving_certificate_issued'&&item.targetId===first.id).details.templateProjectRevision,preview.certificateProjectRevision)
})

test('证书模板严格验证纯文本、完整结构、变量、颜色和背景地址',()=>{
  assert.deepEqual(validateGivingTemplate({...DEFAULT_CERTIFICATE_TEMPLATE}),DEFAULT_CERTIFICATE_TEMPLATE)
  for(const patch of [
    {schemaVersion:2},{title:''},{title:'a'.repeat(61)},{subtitle:'a'.repeat(121)},
    {message:'a'.repeat(801)},{issuer:''},{issuer:'a'.repeat(121)},{signature:'a'.repeat(121)},
    {message:'<script>alert(1)</script>'},{message:'{unknown}'},{message:'{{recipientName}}'},
    {message:'{recipientName'},{title:'test\u0000value'},
    {primaryColor:'red'},{accentColor:'#fff'},{paperColor:'#abcdef;background:url(https://evil.example)'},
    {backgroundUrl:'https://evil.example/bg.png'},{backgroundUrl:'//evil.example/bg.png'},
    {backgroundUrl:'data:image/png;base64,AA=='},{backgroundUrl:'/api/v1/media/../../secret.png'},
    {backgroundUrl:'/api/v1/media/private/manual-verifications/550e8400-e29b-41d4-a716-446655440000.png'},
    {backgroundUrl:'/api/v1/media/550e8400-e29b-41d4-a716-446655440000.svg'},
    {backgroundUrl:'/api/v1/media/550e8400-e29b-41d4-a716-446655440000.png?token=secret'},
    {layout:'arbitrary-css'},{extra:'not-supported'}
  ])assert.throws(()=>validateGivingTemplate({...DEFAULT_CERTIFICATE_TEMPLATE,...patch}),error=>error.code.startsWith('GIVING_TEMPLATE_'),JSON.stringify(patch))
  assert.throws(()=>validateGivingTemplate({title:'partial'}))
  assert.throws(()=>validateGivingTemplate(null))
})

test('证书背景必须为存在的公开图片文件，拒绝伪格式、缺失文件与符号链接',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-certificate-background-'))
  t.after(()=>fs.rm(directory,{recursive:true,force:true}))
  const filename='550e8400-e29b-41d4-a716-446655440000.png'
  const template=validateGivingTemplate({...DEFAULT_CERTIFICATE_TEMPLATE,backgroundUrl:`/api/v1/media/${filename}`})
  await assert.rejects(verifyGivingBackground(template,directory),{code:'GIVING_TEMPLATE_BACKGROUND_INVALID'})
  await fs.writeFile(path.join(directory,filename),'<script>not an image</script>')
  await assert.rejects(verifyGivingBackground(template,directory),{code:'GIVING_TEMPLATE_BACKGROUND_INVALID'})
  await fs.writeFile(path.join(directory,filename),Buffer.from([137,80,78,71,13,10,26,10]))
  await verifyGivingBackground(template,directory)
  await fs.rename(path.join(directory,filename),path.join(directory,'original.png'))
  await fs.symlink(path.join(directory,'original.png'),path.join(directory,filename))
  await assert.rejects(verifyGivingBackground(template,directory),{code:'GIVING_TEMPLATE_BACKGROUND_INVALID'})
})

test('专属证书模板保存遵守项目委派范围，禁止普通用户、前台及通用编辑注入',async t=>{
  const {app,accounts,headers}=await fixture(t)
  const first=await createGivingProject(app,headers.admin),second=await createGivingProject(app,headers.admin)
  const revision=app.services.business.getAdmin('giving-projects',first.id).revision
  assert.equal((await saveTemplate(app,{},first.id,templatePayload(revision))).statusCode,401)
  assert.equal((await saveTemplate(app,headers.user,first.id,templatePayload(revision))).statusCode,403)
  await app.services.delegations.create(accounts.admin,{accountId:accounts.user.id,resource:'giving-projects',resourceId:first.id,permissions:['read','update']},{actor:accounts.admin.id})
  assert.equal((await saveTemplate(app,headers.user,first.id,templatePayload(revision))).statusCode,200)
  assert.equal((await saveTemplate(app,headers.user,second.id,templatePayload(revision))).statusCode,403)
  for(const method of ['POST','PATCH']){
    const response=await app.inject({method,url:`/api/v1/admin/business/giving-projects${method==='PATCH'?'/'+first.id:''}`,headers:headers.admin,payload:{title:'模板绕过测试',certificateTemplate:{...DEFAULT_CERTIFICATE_TEMPLATE}}})
    assert.equal(response.statusCode,400)
    assert.equal(response.json().code,'BUSINESS_PROTECTED_FIELD')
  }
})

test('证书模板并发只保存一次，事务排队后撤权与写盘失败均不留模板或成功审计',async t=>{
  const {app,accounts,headers}=await fixture(t)
  const project=await createGivingProject(app,headers.admin)
  const revision=app.services.business.getAdmin('giving-projects',project.id).revision
  const responses=await Promise.all([saveTemplate(app,headers.admin,project.id,templatePayload(revision,{title:'并发模板甲'})),saveTemplate(app,headers.admin,project.id,templatePayload(revision,{title:'并发模板乙'}))])
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409])
  const stored=app.services.business.getAdmin('giving-projects',project.id)
  const before=app.services.database.read()
  const persist=app.services.database.persist
  app.services.database.persist=async()=>{throw new Error('isolated disk failure')}
  try{assert.equal((await saveTemplate(app,headers.admin,project.id,templatePayload(stored.revision,{title:'不能留下这个设计'}))).statusCode,500)}finally{app.services.database.persist=persist}
  assert.deepEqual(app.services.database.read(),before)
  let release
  const wait=new Promise(resolve=>{release=resolve})
  const blocking=app.services.database.transaction(async state=>{await wait;state.accounts.find(a=>a.id===accounts.admin.id).status='suspended'})
  const pending=app.services.business.saveGivingCertificateTemplate(project.id,templatePayload(stored.revision),{actor:accounts.admin.id},state=>{
    if(!state.accounts.some(a=>a.id===accounts.admin.id&&a.status==='active'))throw Object.assign(new Error('revoked'),{code:'ADMIN_SCOPE_REQUIRED'})
  })
  release();await blocking
  await assert.rejects(pending,{code:'ADMIN_SCOPE_REQUIRED'})
  assert.deepEqual(app.services.business.getAdmin('giving-projects',project.id).certificateTemplate,stored.certificateTemplate)
})

async function createGivingProject(app, adminHeaders) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/giving-projects',
    headers: adminHeaders,
    payload: {
      title: '新财经学子成长公益计划',
      organizer: '湖南财政经济学院',
      summary: '支持学子成长的正式公益项目。',
      description: '经后台审核后公开。'
    }
  })
  assert.equal(created.statusCode, 201)
  const project = created.json().data
  const published = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/giving-projects/${project.id}/actions`,
    headers: adminHeaders,
    payload: { action: 'publish' }
  })
  assert.equal(published.statusCode, 200)
  return project
}

async function submitGivingIntent(app, userHeaders, projectId, payload = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: userHeaders,
    payload: {
      type: 'giving-intent',
      resourceId: projectId,
      payload: {
        amountIntent: '1000',
        message: '支持母校学子成长。',
        ...payload
      }
    }
  })
  assert.equal(response.statusCode, 201, response.body)
  return response.json().data
}

test('公益意向不能伪造证书，专用动作核验到账后签发唯一 owner-only 证书', async (t) => {
  const { app, accounts, headers } = await fixture(t)
  const forgedProjectCreate = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/giving-projects',
    headers: headers.admin,
    payload: {
      title: '伪造证书字段的公益项目',
      certificate: { certificateNo: 'FAKE-PUBLIC-CERTIFICATE' },
      officialReceiptNo: 'FAKE-PUBLIC-RECEIPT'
    }
  })
  assert.equal(forgedProjectCreate.statusCode, 400)
  assert.equal(forgedProjectCreate.json().code, 'BUSINESS_PROTECTED_FIELD')

  const project = await createGivingProject(app, headers.admin)
  await app.services.database.transaction((data) => {
    const stored = data.business.resources['giving-projects']
      .find((item) => item.id === project.id)
    Object.assign(stored, {
      certificate: { certificateNo: 'LEGACY-PUBLIC-CERTIFICATE' },
      certificateNo: 'LEGACY-PUBLIC-CERTIFICATE',
      certificateNumber: 'LEGACY-PUBLIC-CERTIFICATE',
      confirmedAmount: 999999,
      officialReceiptNo: 'LEGACY-PUBLIC-RECEIPT',
      recipientName: '不应公开的受赠人'
    })
  })
  const legacyPublicProject = await app.inject({
    method: 'GET',
    url: `/api/v1/business/giving-projects/${project.id}`
  })
  assert.equal(legacyPublicProject.statusCode, 200)
  for (const field of [
    'certificate',
    'certificateNo',
    'certificateNumber',
    'confirmedAmount',
    'officialReceiptNo',
    'recipientName'
  ]) {
    assert.equal(legacyPublicProject.json().data[field], undefined, field)
  }

  const intent = await submitGivingIntent(app, headers.user, project.id, {
    certificate: {
      certificateNo: 'FAKE-CERTIFICATE',
      issuer: '伪造单位'
    },
    certificateNo: 'FAKE-CERTIFICATE',
    confirmedAmount: 999999,
    donatedAt: '2026-01-01',
    officialReceiptNo: 'FAKE-RECEIPT',
    receiptNo: 'FAKE-RECEIPT',
    issuer: '伪造单位',
    issuedAt: '2026-01-01T00:00:00.000Z'
  })
  for (const field of [
    'certificate',
    'certificateNo',
    'confirmedAmount',
    'donatedAt',
    'officialReceiptNo',
    'receiptNo',
    'issuer',
    'issuedAt'
  ]) {
    assert.equal(intent.payload[field], undefined, field)
  }
  assert.equal(intent.status, 'submitted')

  for (const action of ['approve', 'complete']) {
    const bypass = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/business/applications/${intent.id}/actions`,
      headers: headers.admin,
      payload: { action }
    })
    assert.equal(bypass.statusCode, 409)
    assert.equal(bypass.json().code, 'GIVING_CERTIFICATE_ACTION_REQUIRED')
  }

  await app.services.database.transaction((data) => {
    const account = data.accounts.find((item) => item.id === accounts.user.id)
    account.schoolIdentityVerified = false
    account.schoolIdentityVerifiedAt = null
  })
  const identityRejected = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${intent.id}/actions`,
    headers: headers.admin,
    payload: {
      action: 'issue_certificate',
      confirmedAmount: 1000,
      donatedAt: '2026-07-19',
      officialReceiptNo: 'HUFE-RECEIPT-0001'
    }
  })
  assert.equal(identityRejected.statusCode, 409)
  assert.equal(identityRejected.json().code, 'GIVING_CERTIFICATE_IDENTITY_REQUIRED')
  await app.services.database.transaction((data) => {
    const account = data.accounts.find((item) => item.id === accounts.user.id)
    account.schoolIdentityVerified = true
    account.schoolIdentityVerifiedAt = new Date().toISOString()
  })

  const invalidAmount = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${intent.id}/actions`,
    headers: headers.admin,
    payload: {
      action: 'issue_certificate',
      confirmedAmount: 0,
      donatedAt: '2026-07-19',
      officialReceiptNo: 'HUFE-RECEIPT-0001'
    }
  })
  assert.equal(invalidAmount.statusCode, 400)
  assert.equal(invalidAmount.json().code, 'GIVING_CERTIFICATE_AMOUNT_INVALID')

  const forgedIssuer = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${intent.id}/actions`,
    headers: headers.admin,
    payload: {
      action: 'issue_certificate',
      confirmedAmount: 1000,
      donatedAt: '2026-07-19',
      officialReceiptNo: 'HUFE-RECEIPT-0001',
      issuer: '非学校单位'
    }
  })
  assert.equal(forgedIssuer.statusCode, 400)
  assert.equal(forgedIssuer.json().code, 'GIVING_CERTIFICATE_FIELD_INVALID')

  const issued = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${intent.id}/actions`,
    headers: headers.admin,
    payload: {
      action: 'issue_certificate',
      confirmedAmount: 1000.25,
      donatedAt: '2026-07-19',
      officialReceiptNo: 'HUFE-RECEIPT-0001',
      title: '湖财校友公益捐赠证书',
      note: '感谢支持新财经学子成长。'
    }
  })
  assert.equal(issued.statusCode, 200, issued.body)
  assert.equal(issued.json().data.status, 'completed')
  const certificate = issued.json().data.certificate
  assert.match(certificate.certificateNo, /^HUFE-GIVING-\d{4}-[A-F0-9]{12}$/u)
  assert.equal(certificate.recipientName, '捐赠校友甲')
  assert.equal(certificate.projectTitle, '新财经学子成长公益计划')
  assert.equal(certificate.confirmedAmount, 1000.25)
  assert.equal(certificate.donatedAt, '2026-07-19')
  assert.equal(certificate.officialReceiptNo, 'HUFE-RECEIPT-0001')
  assert.equal(certificate.issuer, '湖南财政经济学院')
  assert.equal(certificate.title, '湖财校友公益捐赠证书')
  assert.equal(certificate.note, '感谢支持新财经学子成长。')
  assert.match(certificate.issuedAt, /^\d{4}-\d{2}-\d{2}T/u)

  const mine = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/submissions?type=giving-intent',
    headers: headers.user
  })
  assert.equal(mine.statusCode, 200)
  assert.equal(mine.json().data.total, 1)
  assert.deepEqual(mine.json().data.items[0].certificate, certificate)
  assert.equal(mine.json().data.items[0].completedBy, undefined)

  const other = await app.inject({
    method: 'GET',
    url: '/api/v1/business/me/submissions?type=giving-intent',
    headers: headers.other
  })
  assert.equal(other.statusCode, 200)
  assert.equal(other.json().data.total, 0)
  assert.equal(JSON.stringify(other.json().data).includes(certificate.certificateNo), false)

  const publicProject = await app.inject({
    method: 'GET',
    url: `/api/v1/business/giving-projects/${project.id}`
  })
  assert.equal(publicProject.statusCode, 200)
  assert.equal(JSON.stringify(publicProject.json().data).includes(certificate.certificateNo), false)
  assert.equal(JSON.stringify(publicProject.json().data).includes('HUFE-RECEIPT-0001'), false)

  const duplicateIssue = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${intent.id}/actions`,
    headers: headers.admin,
    payload: {
      action: 'issue_certificate',
      confirmedAmount: 1000.25,
      donatedAt: '2026-07-19',
      officialReceiptNo: 'HUFE-RECEIPT-0001'
    }
  })
  assert.equal(duplicateIssue.statusCode, 409)
  assert.equal(duplicateIssue.json().code, 'GIVING_CERTIFICATE_ALREADY_ISSUED')

  const stored = app.services.database.read((data) => ({
    audit: data.auditLogs.find((item) => item.action === 'business.giving_certificate_issued'),
    notification: data.business.notifications.find((item) => item.type === 'giving.certificate_issued')
  }))
  assert.equal(stored.audit.targetId, intent.id)
  assert.equal(stored.audit.details.certificateNo, certificate.certificateNo)
  assert.equal(stored.notification.accountId, accounts.user.id)
  assert.equal(stored.notification.status, 'completed')
})

test('公益证书回执号与证书编号保持唯一，其他业务申请不能调用签发动作', async (t) => {
  const { app, headers } = await fixture(t)
  const project = await createGivingProject(app, headers.admin)
  const first = await submitGivingIntent(app, headers.user, project.id)
  const second = await submitGivingIntent(app, headers.user, project.id)

  const issue = async (id, receipt) => app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/applications/${id}/actions`,
    headers: headers.admin,
    payload: {
      action: 'issue_certificate',
      confirmedAmount: 88.8,
      donatedAt: '2026-07-19',
      officialReceiptNo: receipt
    }
  })

  const firstIssued = await issue(first.id, 'HUFE-RECEIPT-UNIQUE-1')
  assert.equal(firstIssued.statusCode, 200)
  const duplicateReceipt = await issue(second.id, 'HUFE-RECEIPT-UNIQUE-1')
  assert.equal(duplicateReceipt.statusCode, 409)
  assert.equal(duplicateReceipt.json().code, 'GIVING_CERTIFICATE_RECEIPT_DUPLICATE')
  const secondIssued = await issue(second.id, 'HUFE-RECEIPT-UNIQUE-2')
  assert.equal(secondIssued.statusCode, 200)
  assert.notEqual(
    firstIssued.json().data.certificate.certificateNo,
    secondIssued.json().data.certificate.certificateNo
  )

  const activity = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/activities',
    headers: headers.admin,
    payload: {
      title: '证书动作隔离测试活动',
      category: '校友活动',
      organizer: '学校',
      venue: '厚生楼',
      startAt: '2099-07-19T10:00:00+08:00',
      description: '用于验证公益证书动作不能用于其他申请。'
    }
  })
  await app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/activities/${activity.json().data.id}/actions`,
    headers: headers.admin,
    payload: { action: 'publish' }
  })
  const eventSubmission = await app.inject({
    method: 'POST',
    url: '/api/v1/business/submissions',
    headers: headers.user,
    payload: {
      type: 'event-registration',
      resourceId: activity.json().data.id,
      payload: {}
    }
  })
  const invalidTarget = await issue(eventSubmission.json().data.id, 'HUFE-RECEIPT-INVALID-TARGET')
  assert.equal(invalidTarget.statusCode, 400)
  assert.equal(invalidTarget.json().code, 'GIVING_CERTIFICATE_ACTION_INVALID')
})
