export const dossierTabs = [
  {key:'basic',label:'基本信息'}, {key:'tags',label:'校友标签'},
  {key:'resources',label:'资源需求与供给'}, {key:'enterprises',label:'校企合作'},
  {key:'activities',label:'活动记录'}, {key:'giving',label:'捐赠记录'},
  {key:'followups',label:'跟进记录'}, {key:'relations',label:'校友关系'},
  {key:'analysis',label:'资料概览'}
]
export const followupMethods = {phone:'电话',wechat:'微信',email:'邮件',visit:'走访',event:'活动沟通',other:'其他'}
export const contactFields = {phone:'手机 / 电话',email:'联系邮箱',wechat:'微信号',city:'所在地区',regionCode:'地区代码',address:'联系地址'}
export const educationFields = {school:'学校名称',department:'学院 / 部门',major:'专业',degree:'学历 / 学位',startYear:'开始年份',endYear:'结束年份',note:'补充说明'}
export const employmentFields = {company:'工作单位',title:'职务',industry:'所属行业',startDate:'入职日期',endDate:'离职日期',note:'补充说明'}
export const recordFields = {
  resources:['title','category','status','description','priority','occurredAt','validUntil','cooperationModes','partner','resources','progress','outcomes'],
  enterprises:['title','category','status','description','priority','occurredAt','validUntil','cooperationModes','partner','resources','progress','outcomes'],
  activities:['title','category','status','description','priority','occurredAt','validUntil','partner','resources','progress','outcomes'],
  giving:['title','category','status','description','priority','occurredAt','validUntil','partner','progress','outcomes','amount'],
  relations:['title','category','status','description','priority','occurredAt','validUntil','targetAccountId','relationship']
}
export const internalRecordLabels={resources:'供需记录',enterprises:'合作项目',activities:'活动记录',giving:'捐赠联系记录',relations:'关系记录'}
export const internalStatuses={pending:'待推进',active:'进行中',completed:'已完成',paused:'已暂停'}
export function recordDraft(section,value={}){if(!recordFields[section])throw Error('不支持的内部记录板块');return Object.fromEntries(recordFields[section].map(key=>[key,key==='amount'?value[key]??null:key==='cooperationModes'?[...(value[key]||[])]:typeof value[key]==='string'?value[key]:key==='status'?'active':key==='priority'?'normal':'']))}
export function recordUpdate(section,value){const row=recordDraft(section,value);if(Object.hasOwn(row,'amount'))row.amount=row.amount===''||row.amount===null?null:Number(row.amount);if(row.cooperationModes)row.cooperationModes=[...new Set(row.cooperationModes.map(value=>value.trim()).filter(Boolean))];return row}
const strings = (value,fields) => Object.fromEntries(Object.keys(fields).map(key=>[key,typeof value?.[key]==='string'?value[key]:'']))
export function profileDraft(value={}) { return {contacts:strings(value.contacts,contactFields),education:(value.education||[]).map(row=>strings(row,educationFields)),employment:(value.employment||[]).map(row=>strings(row,employmentFields)),tags:Array.isArray(value.tags)?value.tags.filter(x=>typeof x==='string'):[],notes:typeof value.notes==='string'?value.notes:''} }
export function profileUpdate(kind,draft) { if(!['contacts','education','employment','tags','notes'].includes(kind))throw Error('不支持的档案编辑类型');return {[kind]:profileDraft(draft)[kind]} }
export function academicFields(dossier={}) {
  const account=dossier.account||{}, profile=dossier.personalProfile||{}, values=profile.fields||account
  return [{label:'校友编号',value:account.alumniNo},{label:'平台用户名',value:account.username},{label:'学院 / 部门',value:account.department},{label:'专业',value:values.major},{label:'班级',value:values.className},{label:'入学年份',value:values.enrollmentYear&&`${values.enrollmentYear}年`},{label:account.personType==='student'&&!profile.graduationYearConfirmed?'预计毕业年份':'毕业年份',value:account.personType==='student'&&!profile.graduationYearConfirmed?values.expectedGraduationYear&&`${values.expectedGraduationYear}年`:values.graduationYear&&`${values.graduationYear}年`}]
}
export function confirmedGivingAmount(rows=[]) { return rows.reduce((cents,row)=>cents+(row.certificate?.certificateNo&&Number.isFinite(row.certificate.confirmedAmount)&&row.certificate.confirmedAmount>0?Math.round(row.certificate.confirmedAmount*100):0),0)/100 }
export function displayDate(value){if(!value)return '未记录';const date=new Date(value);return Number.isNaN(date.getTime())?'未记录':date.toLocaleDateString('zh-CN').replaceAll('/','-')}
