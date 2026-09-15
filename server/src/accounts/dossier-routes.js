import { DossierService } from './dossier.js'

export function registerDossierRoutes(app, { accounts, regions, requireSuperAdmin, requestMeta, data }) {
  const service = new DossierService(accounts, { regions })
  const authorize = (request, reply) => { reply.header('cache-control', 'private, no-store'); return requireSuperAdmin(request) }
  app.get('/api/v1/admin/accounts/:id/dossier', async (request, reply) => data(service.get(authorize(request, reply), request.params.id)))
  app.get('/api/v1/admin/accounts/:id/dossier/:section', async (request, reply) => data(service.section(authorize(request, reply), request.params.id, request.params.section, request.query)))
  const writes = { bodyLimit: 64 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }
  app.put('/api/v1/admin/accounts/:id/dossier/profile', writes, async (request, reply) => {
    const actor = authorize(request, reply)
    return data(await service.updateProfile(actor, request.params.id, request.body, requestMeta(request, actor.id)))
  })
  app.post('/api/v1/admin/accounts/:id/dossier/followups', writes, async (request, reply) => {
    const actor = authorize(request, reply)
    reply.code(201)
    return data(await service.addFollowup(actor, request.params.id, request.body, requestMeta(request, actor.id)))
  })
  app.patch('/api/v1/admin/accounts/:id/dossier/followups/:followupId', writes, async (request, reply) => {
    const actor = authorize(request, reply)
    return data(await service.updateFollowup(actor, request.params.id, request.params.followupId, request.body, requestMeta(request, actor.id)))
  })
  app.post('/api/v1/admin/accounts/:id/dossier/records/:section', writes, async (request, reply) => {
    const actor = authorize(request, reply)
    reply.code(201)
    return data(await service.saveRecord(actor, request.params.id, request.params.section, null, request.body, requestMeta(request, actor.id)))
  })
  app.put('/api/v1/admin/accounts/:id/dossier/records/:section/:recordId', writes, async (request, reply) => {
    const actor = authorize(request, reply)
    return data(await service.saveRecord(actor, request.params.id, request.params.section, request.params.recordId, request.body, requestMeta(request, actor.id)))
  })
  app.delete('/api/v1/admin/accounts/:id/dossier/records/:section/:recordId', writes, async (request, reply) => {
    const actor = authorize(request, reply)
    return data(await service.archiveRecord(actor, request.params.id, request.params.section, request.params.recordId, request.body, requestMeta(request, actor.id)))
  })
  app.post('/api/v1/admin/accounts/:id/dossier/student-number', { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = authorize(request, reply)
    return data(await service.revealStudentNumber(actor, request.params.id, request.body, requestMeta(request, actor.id)))
  })
  return service
}
