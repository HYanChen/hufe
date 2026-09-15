const fields=['creditCode','industry','city','regionCode','summary','contactMethod']
export function applyEnterpriseLookup(form,result,name){
 if(!result?.available||form.enterpriseName.trim()!==name||result.enterpriseName!==name)return {}
 const applied={}
 for(const key of fields)if(!['city','regionCode'].includes(key)&&!form[key]&&typeof result.fields?.[key]==='string'&&result.fields[key]){form[key]=result.fields[key];applied[key]=form[key]}
 // 城市文字与地区编号必须作为一对填写，不能把用户选择的城市和查询城市混合。
 if(!form.city&&!form.regionCode&&result.fields?.city&&result.fields?.regionCode){for(const key of ['city','regionCode']){form[key]=result.fields[key];applied[key]=form[key]}}
 return applied
}
export function clearEnterpriseAutofill(form,applied={}){
 for(const [key,value] of Object.entries(applied))if(fields.includes(key)&&form[key]===value)form[key]=''
}
