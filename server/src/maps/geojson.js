import {mapError} from './pmtiles.js'

export function validateGeojson(value){
  if(!value||value.type!=='FeatureCollection'||!Array.isArray(value.features)||value.features.length>1000)throw mapError('请输入 FeatureCollection 格式 GeoJSON，每层最多1000个要素')
  let count=0
  const coordinate=v=>{if(!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite)||Math.abs(v[0])>180||Math.abs(v[1])>85.051129)throw mapError('坐标须为 WGS84 经度、纬度，不能使用偏移坐标或第三维');if(++count>20000)throw mapError('每层最多20000个坐标点');return [...v]}
  const line=v=>{if(!Array.isArray(v)||v.length<2)throw mapError('线至少需要2个点');return v.map(coordinate)}
  const polygon=v=>{if(!Array.isArray(v)||!v.length)throw mapError('面坐标不能为空');return v.map(ring=>{if(!Array.isArray(ring)||ring.length<4||JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1)))throw mapError('面的边界至少3个点并须闭合');return ring.map(coordinate)})}
  const text=(v,max)=>String(v??'').replace(/[\u0000-\u001f]/g,'').slice(0,max)
  return {type:'FeatureCollection',features:value.features.map((feature,index)=>{
    if(feature?.type!=='Feature'||!feature.geometry||!['Point','LineString','Polygon'].includes(feature.geometry.type))throw mapError(`第${index+1}个要素只支持点、线、面`)
    const {type,coordinates}=feature.geometry,props=feature.properties||{}
    if(typeof props!=='object'||Array.isArray(props))throw mapError('要素属性必须是对象')
    return {type:'Feature',id:index+1,properties:{name:text(props.name,120),description:text(props.description,500),color:/^#[a-f0-9]{6}$/i.test(props.color)?props.color:'#d65a42'},geometry:{type,coordinates:type==='Point'?coordinate(coordinates):type==='LineString'?line(coordinates):polygon(coordinates)}}
  })}
}
