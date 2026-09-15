import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import {JsonDatabase} from '../src/storage/json-database.js'
import {AccountService} from '../src/accounts/service.js'
import {PersonnelService} from '../src/accounts/personnel.js'
import {registerPersonnelRoutes} from '../src/accounts/personnel-routes.js'
import {crc32,parsePersonnelWorkbook,personnelColumns,readXlsxZip} from '../src/accounts/xlsx.js'
import {hmac,verifyPassword} from '../src/auth/crypto.js'
import {selfStudentNumber} from '../src/accounts/student-number.js'

async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hufe-personnel-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const config={dataFile:path.join(directory,'data.json'),dataHashSecret:'personnel-test-secret',env:'test'},database=await new JsonDatabase(config.dataFile).init();await database.transaction(d=>d.accounts.push({id:'admin',username:'admin',isAdmin:true,status:'active'},{id:'second-admin',username:'second-admin',isAdmin:true,status:'active'},{id:'ordinary',username:'ordinary',status:'active',isAdmin:false}));const accounts=new AccountService(database,config);return {database,accounts,service:new PersonnelService(accounts),config,admin:{id:'admin'}}}
const person=(extra={})=>({username:'校友甲',name:'测试校友',personType:'校友',department:'测试学院',major:'计算机科学与技术',className:'测试一班',studentId:'002200001',enrollmentYear:'2022',graduationYear:'2024',expectedGraduationYear:'',...extra})
const preview=(service,admin,rows)=>service.preview(admin,rows.map((input,index)=>({rowNumber:index+2,input})))
const apply=(service,admin,p,extra={})=>service.apply(admin,{token:p.token,verificationMode:'unverified',...extra},{actor:admin.id})

test('ordinary personnel preview does not persist; explicit manual verification preserves provenance and grants no admin rights',async t=>{
  const {database,accounts,service,config,admin}=await fixture(t),before=await fs.readFile(config.dataFile,'utf8')
  const p=preview(service,admin,[person()]);assert.equal(p.invalid,0);assert.equal(await fs.readFile(config.dataFile,'utf8'),before);assert.equal(JSON.stringify(p).includes('002200001'),false)
  await assert.rejects(apply(service,admin,p,{verificationMode:'manual'}),e=>e.code==='PERSONNEL_INVALID')
  const r=await apply(service,admin,p,{verificationMode:'manual',manualVerificationConfirmed:true,verificationBasis:'已核对本人身份证明及毕业材料'})
  assert.equal(r.created,1)
  const stored=database.read(d=>d.accounts.find(a=>a.id===r.accountIds[0]))
  assert.equal(stored.schoolIdentityVerified,true);assert.equal(stored.verificationSource,'admin-personnel-review');assert.equal(stored.accountSource,'admin_personnel');assert.equal(stored.isAdmin,false);assert.equal(stored.mustChangePassword,true)
  assert.equal(stored.studentIdKey,hmac('student-id:002200001',config.dataHashSecret));assert.equal(stored.studentId,undefined);assert.equal(stored.studentIdDisplay,undefined);assert.equal(await verifyPassword('校友甲123456',stored.passwordHash),true)
  assert.equal(selfStudentNumber(stored,config.dataHashSecret),'002200001');assert.equal(JSON.stringify(stored).includes('002200001'),false)
  assert.equal(database.read(d=>d.adminDelegations.length),0)
  assert.equal(accounts.listAccounts({verification:'manual'}).total,1)
  assert.equal(accounts.listAccounts({query:'002200001'}).items[0].id,stored.id)
  const safe=accounts.listAccounts({query:'校友甲'}).items[0];assert.equal(safe.passwordHash,undefined);assert.equal(safe.studentIdKey,undefined)
  assert.equal(safe.studentIdSealed,undefined)
  assert.equal(database.read(d=>d.auditLogs.filter(r=>r.action==='account.personnel_imported').length),1)
})
test('default personnel are unverified; same-name people are allowed but usernames and stable school IDs are checked across all records and rows',async t=>{
  const {database,service,admin,config}=await fixture(t)
  const p=preview(service,admin,[person(),person({username:'校友乙',studentId:'002200002'})]);assert.equal(p.invalid,0)
  const created=await apply(service,admin,p);assert.equal(created.created,2)
  assert.ok(database.read(d=>created.accountIds.every(id=>d.accounts.find(a=>a.id===id).schoolIdentityVerified===false)))
  await database.transaction(d=>{const a=d.accounts.find(a=>a.id===created.accountIds[0]);a.status='deactivated'})
  const bad=preview(service,admin,[person({username:'校友甲',studentId:'002200003'}),person({username:'other_name',studentId:'002200001'}),person({username:'DUPE',studentId:'002200005'}),person({username:'dupe',studentId:'002200005'})])
  assert.equal(bad.invalid,4);assert.ok(bad.items[2].errors.some(e=>e.includes('第5行')));assert.ok(bad.items[3].errors.some(e=>e.includes('第4行')))
  const before=await fs.readFile(config.dataFile,'utf8');await assert.rejects(apply(service,admin,bad),e=>e.code==='PERSONNEL_ROWS_INVALID');assert.equal(await fs.readFile(config.dataFile,'utf8'),before)
})
test('duplicate requests, process restart receipts and competing previews cannot create extra personnel or reset existing credentials',async t=>{
  const {database,service,accounts,admin}=await fixture(t)
  const first=preview(service,admin,[person()]),second=preview(service,{id:'second-admin'},[person()])
  const pending=apply(service,admin,first)
  await assert.rejects(apply(service,admin,first),e=>e.code==='PERSONNEL_APPLY_BUSY')
  const result=await pending,hash=database.read(d=>d.accounts.find(a=>a.id===result.accountIds[0]).passwordHash)
  const repeated=await apply(new PersonnelService(accounts),admin,first);assert.equal(repeated.alreadyApplied,true);assert.deepEqual(repeated.accountIds,result.accountIds)
  await assert.rejects(apply(service,{id:'second-admin'},second),e=>e.code==='PERSONNEL_IMPORT_CONFLICT')
  assert.equal(database.read(d=>d.accounts.filter(a=>a.accountSource==='admin_personnel').length),1);assert.equal(database.read(d=>d.accounts.find(a=>a.id===result.accountIds[0]).passwordHash),hash)
  await assert.rejects(apply(service,{id:'second-admin'},first),e=>e.code==='PERSONNEL_PREVIEW_FORBIDDEN')
})
test('permissions are rechecked inside commit; failures and expired previews leave the database intact',async t=>{
  const {database,service,admin,config}=await fixture(t)
  assert.throws(()=>preview(service,{id:'ordinary'},[person()]),e=>e.statusCode===403)
  const first=preview(service,admin,[person()]);await assert.rejects(apply(service,{id:'second-admin'},first),e=>e.code==='PERSONNEL_PREVIEW_FORBIDDEN')
  service.previews.get(first.token).expiresAt=0;await assert.rejects(apply(service,admin,first),e=>e.code==='PERSONNEL_PREVIEW_EXPIRED')
  const next=preview(service,admin,[person()]),originalPersist=database.persist
  database.persist=async()=>{throw Error('disk full')}
  await assert.rejects(apply(service,admin,next),/disk full/);database.persist=originalPersist
  assert.equal(database.read(d=>d.accounts.some(a=>a.accountSource==='admin_personnel')),false)
  const pending=apply(service,admin,next)
  await database.transaction(d=>{d.accounts.find(a=>a.id===admin.id).status='suspended'})
  await assert.rejects(pending,e=>e.statusCode===403)
  assert.equal(database.read(d=>d.accounts.some(a=>a.accountSource==='admin_personnel')),false)
  assert.equal(JSON.parse(await fs.readFile(config.dataFile,'utf8')).accounts.some(a=>a.accountSource==='admin_personnel'),false)
})
test('invalid years, missing hierarchy and injected privileges are row-level Chinese errors; no partial creation',async t=>{
  const {service,admin}=await fixture(t)
  const p=preview(service,admin,[person({isAdmin:true}),person({username:'valid_2',studentId:'002200002',department:'',enrollmentYear:'2026',graduationYear:'2020'}),person({username:'valid_3',studentId:'002200003',personType:'学生'})])
  assert.equal(p.invalid,3);assert.ok(p.items[0].errors[0].includes('权限'));assert.ok(p.items[1].errors.some(e=>e.includes('不能早于')));assert.ok(p.items[2].errors.some(e=>e.includes('预计毕业')))
  await assert.rejects(apply(service,admin,p),e=>e.code==='PERSONNEL_ROWS_INVALID')
})
test('department-major-class and year/identity/verification/status filters combine with exact school ID lookup',async t=>{
  const {database,accounts,config}=await fixture(t)
  await database.transaction(d=>d.accounts.push(...[
    {id:'a',name:'同名',username:'one',department:'甲学院',major:'计算机',className:'一班',enrollmentYear:'2022',graduationYear:'2024',personType:'alumni',schoolIdentityVerified:true,verificationSource:'school-sso',status:'active',studentIdKey:hmac('student-id:002200001',config.dataHashSecret)},
    {id:'b',name:'同名',username:'two',department:'甲学院',major:'财务',className:'二班',enrollmentYear:'2023',expectedGraduationYear:'2027',personType:'student',schoolIdentityVerified:true,verificationSource:'admin-personnel-review',status:'suspended'},
    {id:'c',name:'其他',username:'three',department:'乙学院',major:'计算机',className:'三班',enrollmentYear:'2022',graduationYear:'2024',personType:'alumni',schoolIdentityVerified:false,status:'active'}
  ]))
  const result=accounts.listAccounts({department:'甲学院',major:'计算机',className:'一班',enrollmentYear:'2022',graduationYear:'2024',personType:'alumni',verification:'school',status:'active',query:'002200001'})
  assert.equal(result.total,1);assert.equal(result.items[0].id,'a');assert.deepEqual(result.filterOptions.majors,['计算机','财务'].sort((a,b)=>a.localeCompare(b,'zh-CN')));assert.deepEqual(result.filterOptions.classes,['一班'])
  assert.equal(accounts.listAccounts({verification:'manual',status:'suspended',expectedGraduationYear:'2027'}).items[0].id,'b')
  assert.throws(()=>accounts.listAccounts({verification:'fake'}),e=>e.code==='ACCOUNT_FILTER_INVALID')
})

function zip(files){let offset=0;const locals=[],central=[];for(const [name,source] of Object.entries(files)){const body=Buffer.from(source),n=Buffer.from(name),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt32LE(crc32(body),14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(n.length,26);locals.push(header,n,body);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc32(body),16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=header.length+n.length+body.length}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end])}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
function workbook(inputs,extra={}){const row=(values,number)=>`<row r="${number}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;return {'[Content_Types].xml':'<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>','xl/workbook.xml':'<workbook><sheets><sheet name="人员导入" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':`<worksheet><sheetData>${row(Object.keys(personnelColumns),1)}${inputs.map((input,index)=>row(Object.values(personnelColumns).map(k=>input[k]||''),index+2)).join('')}</sheetData></worksheet>`,...extra}}
test('real OOXML ZIP parsing preserves text school IDs and rejects formulas, macros, damaged files and numeric identifiers',()=>{
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926)
  const files=workbook([person()]),data=zip(files),rows=parsePersonnelWorkbook(data);assert.equal(rows[0].input.studentId,'002200001');assert.equal(rows[0].rowNumber,2);assert.deepEqual(rows[0].errors,[])
  const formula=workbook([person()]);formula['xl/worksheets/sheet1.xml']=formula['xl/worksheets/sheet1.xml'].replace('<c r="A2"','<c r="A2"><f>SUM(1,2)</f></c><c r="A2"');assert.throws(()=>parsePersonnelWorkbook(zip(formula)),/公式/)
  assert.throws(()=>parsePersonnelWorkbook(zip({...files,'xl/vbaProject.bin':'macro'})),/宏/)
  assert.throws(()=>parsePersonnelWorkbook(zip({...files,'../secret.xml':'secret'})),/不安全/)
  const damaged=Buffer.from(data);damaged[40]^=1;assert.throws(()=>parsePersonnelWorkbook(damaged),e=>e.code==='PERSONNEL_XLSX_INVALID')
  const numeric=workbook([person()]);numeric['xl/worksheets/sheet1.xml']=numeric['xl/worksheets/sheet1.xml'].replace('<c r="G2" t="inlineStr"><is><t>002200001</t></is></c>','<c r="G2"><v>2200001</v></c>');assert.ok(parsePersonnelWorkbook(zip(numeric))[0].errors[0].includes('文本'))
  const external=workbook([person()],{'xl/_rels/external.rels':'<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>'});assert.throws(()=>parsePersonnelWorkbook(zip(external)),/外部链接/)
  const bomb=Buffer.from(data),end=bomb.length-22,cd=bomb.readUInt32LE(end+16);bomb.writeUInt32LE(30*1024*1024,cd+24);assert.throws(()=>readXlsxZip(bomb),/过大/)
})
test('API routes are super-admin-only and workbook preview is still read-only',async t=>{
  const {accounts,admin,config,database}=await fixture(t),app=Fastify()
  const guard=request=>{if(request.headers.authorization!=='super')throw Object.assign(new Error('仅超级管理员可操作'),{statusCode:403});return admin}
  registerPersonnelRoutes(app,{accounts,requireSuperAdmin:guard,requestMeta:()=>({actor:admin.id}),data:value=>({code:0,data:value})})
  t.after(()=>app.close())
  assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/personnel/preview',payload:person()})).statusCode,403)
  assert.equal((await app.inject({url:'/api/v1/admin/personnel/template'})).statusCode,403)
  const before=await fs.readFile(config.dataFile,'utf8')
  const response=await app.inject({method:'POST',url:'/api/v1/admin/personnel/import-preview',headers:{authorization:'super'},payload:{filename:'名单.xlsx',contentBase64:zip(workbook([person()])).toString('base64')}})
  assert.equal(response.statusCode,200);assert.equal(response.json().data.valid,1);assert.equal(await fs.readFile(config.dataFile,'utf8'),before)
  const result=await app.inject({method:'POST',url:'/api/v1/admin/personnel/apply',headers:{authorization:'super'},payload:{token:response.json().data.token,verificationMode:'unverified'}})
  assert.equal(result.statusCode,200);assert.equal(database.read(d=>d.accounts.filter(a=>a.accountSource==='admin_personnel').length),1)
})
test('distributed Excel template is real OOXML with exact headers and no pretend personnel rows',async()=>{
  const file=new URL('../src/accounts/templates/personnel-import.xlsx',import.meta.url)
  const bytes=await fs.readFile(file)
  assert.ok(readXlsxZip(bytes).has('xl/workbook.xml'))
  assert.throws(()=>parsePersonnelWorkbook(bytes),/没有数据/)
  const content=readXlsxZip(bytes),sheet=content.get('xl/worksheets/sheet1.xml').toString(),header=sheet.match(/<x:row r="1"[^>]*>[\s\S]*?<\/x:row>/)[0]
  const filled=`<x:row r="2">${Object.values(personnelColumns).map((key,index)=>`<x:c r="${String.fromCharCode(65+index)}2" t="inlineStr"><x:is><x:t>${escape(person()[key]||'')}</x:t></x:is></x:c>`).join('')}</x:row>`
  content.set('xl/worksheets/sheet1.xml',Buffer.from(sheet.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/,`<x:sheetData>${header}${filled}</x:sheetData>`)))
  const parsed=parsePersonnelWorkbook(zip(Object.fromEntries(content)))
  assert.equal(parsed.length,1);assert.equal(parsed[0].input.username,'校友甲');assert.equal(parsed[0].input.studentId,'002200001')
})
