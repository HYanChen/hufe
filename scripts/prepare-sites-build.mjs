import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const dist = join(root, 'dist')
const h5 = join(dist, 'build', 'h5')
const hostingConfig = join(root, '.openai', 'hosting.json')
const staging = await mkdtemp(join(tmpdir(), 'hufe-sites-'))
const publicDir = join(staging, 'public')

await cp(h5, publicDir, { recursive: true })
await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, 'server'), { recursive: true })
await mkdir(join(dist, '.openai'), { recursive: true })
await cp(publicDir, join(dist, 'client'), { recursive: true })
await cp(hostingConfig, join(dist, '.openai', 'hosting.json'))

const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || request.method !== 'GET') return response

    const url = new URL(request.url)
    url.pathname = '/index.html'
    return env.ASSETS.fetch(new Request(url, request))
  },
}
`

await writeFile(join(dist, 'server', 'index.js'), worker)

const indexPath = join(dist, 'client', 'index.html')
const index = await readFile(indexPath, 'utf8')
if (!index.includes('<div id="app">')) {
  throw new Error('Sites build validation failed: H5 entrypoint is missing.')
}

console.log('Sites deployment bundle prepared in dist/.')
