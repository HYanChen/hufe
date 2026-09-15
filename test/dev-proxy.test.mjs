import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {developmentApiProxy} from '../config/devProxy.js'

test('H5 development proxies local map resources to the normal API', () => {
  assert.deepEqual(developmentApiProxy(), {'/api':{target:'http://127.0.0.1:8787',changeOrigin:true},'/health':{target:'http://127.0.0.1:8787',changeOrigin:true}})
  assert.match(readFileSync(new URL('../vite.config.js', import.meta.url),'utf8'), /server:\s*\{\s*proxy:\s*developmentApiProxy\(process.env\)/)
})
test('isolated API and same-origin production builds keep correct proxy origins', () => {
  assert.equal(developmentApiProxy({VITE_API_BASE_URL:'http://127.0.0.1:8879/api/v1'})['/api'].target,'http://127.0.0.1:8879')
  assert.equal(developmentApiProxy({VITE_API_BASE_URL:'/api/v1'})['/api'].target,'http://127.0.0.1:8787')
  assert.equal(developmentApiProxy({HUFE_API_PROXY:'http://127.0.0.1:8890',VITE_API_BASE_URL:'https://example.invalid/api/v1'})['/api'].target,'http://127.0.0.1:8890')
  assert.throws(()=>developmentApiProxy({HUFE_API_PROXY:'file:///tmp/api'}))
  assert.throws(()=>developmentApiProxy({HUFE_API_PROXY:'https://name:secret@example.invalid'}))
})
