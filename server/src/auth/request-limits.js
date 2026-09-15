// An authenticated campus NAT user must not consume a different user's quota.
// Login and registration still use the trusted remote IP, never a supplied ID.
export function requestLimitKey(request){
  const route=request.routeOptions?.url||'unknown'
  const authRoute=route.startsWith('/api/v1/auth/')
  const actor=!authRoute&&request.user?.id?'account:'+request.user.id:'ip:'+request.ip
  const configured=request.routeOptions?.config?.rateLimit
  const group=route.startsWith('/api/v1/maps/viewer/')?'map-viewer':configured?request.method+':'+route:['GET','HEAD','OPTIONS'].includes(request.method)?'read':'write'
  return actor+':'+group
}
export function rateLimitResponse(_request,context){
  const seconds=Math.max(1,Math.ceil(Number(context.ttl||1000)/1000))
  return {statusCode:429,code:'RATE_LIMITED',error:'请求过于频繁',message:`操作较频繁，请在${seconds}秒后重试`}
}
