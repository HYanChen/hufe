import { buildApp } from './app.js'

const app = await buildApp()
const { host, port } = app.services.config

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 25000)
  deadline.unref()
  try { await app.close(); process.exit(0) } catch { process.exit(1) }
})

try {
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
