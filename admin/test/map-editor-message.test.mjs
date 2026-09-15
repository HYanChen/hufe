import test from 'node:test'
import assert from 'node:assert/strict'
import {ref} from 'vue'
import {mapEditorMessage} from '../src/lib/mapEditorMessage.js'

test('GeoJSON iframe 消息去除 Vue 深层代理，并保留点线面属性',()=>{
  const state=ref({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'地图验收',color:'#d65a42'},geometry:{type:'Point',coordinates:[112.9,28.2]}}]})
  assert.throws(()=>structuredClone(state.value))
  const sent=structuredClone(mapEditorMessage(state.value))
  assert.equal(sent.type,'hufe-map-load')
  assert.equal(sent.geojson.features[0].properties.name,'地图验收')
  state.value.features[0].properties.name='后续编辑'
  assert.equal(sent.geojson.features[0].properties.name,'地图验收')
})
