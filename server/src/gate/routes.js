import { requestMetadata } from '../audit/metadata.js'

const data = value => ({ code: 0, message: 'ok', data: value })
export async function registerGateRoutes(app, { gate, requireUser, requestMeta = requestMetadata }) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'private, no-store').header('Pragma', 'no-cache').header('Referrer-Policy', 'no-referrer')
    requireUser(request)
    // Also reject temporary-password accounts for read endpoints and candidates.
    gate.me(request.user.id)
  })
  app.addHook('onRoute', options => {
    options.config = { ...options.config, rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: request => request.user?.id || request.ip, ...options.config?.rateLimit } }
  })
  const limited = max => ({ bodyLimit: 4096, config: { rateLimit: { max, timeWindow: '1 minute' } } })
  const meta = request => requestMeta(request, request.user.id)
  app.get('/api/v1/gate/me', request => data(gate.me(request.user.id)))
  app.get('/api/v1/gate/people', request => data(gate.people(request.user.id, request.query)))
  app.get('/api/v1/gate/staff', request => data(gate.staff(request.user.id, request.query)))
  app.post('/api/v1/gate/staff', limited(20), async request => data(await gate.grant(request.user.id, request.body || {}, meta(request))))
  app.delete('/api/v1/gate/staff/:id', async request => data(await gate.revoke(request.user.id, request.params.id, meta(request))))
  app.get('/api/v1/gate/stations', request => data(gate.stations(request.user.id, request.query)))
  app.post('/api/v1/gate/stations', limited(20), async request => data(await gate.saveStation(request.user.id, request.body || {}, '', meta(request))))
  app.patch('/api/v1/gate/stations/:id', limited(30), async request => data(await gate.saveStation(request.user.id, request.body || {}, request.params.id, meta(request))))
  app.post('/api/v1/gate/passes', limited(30), async request => data(await gate.issue(request.user.id)))
  app.post('/api/v1/gate/scans/preview', limited(40), async request => data(await gate.preview(request.user.id, request.body || {}, meta(request))))
  app.post('/api/v1/gate/scans/confirm', limited(40), async request => data(await gate.confirm(request.user.id, request.body || {}, meta(request))))
  app.get('/api/v1/gate/records', request => data(gate.records(request.user.id, request.query)))
}
