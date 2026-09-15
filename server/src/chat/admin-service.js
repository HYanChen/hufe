import { randomUUID } from 'node:crypto'

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { code: statusCode === 409 ? 'CHAT_MODERATION_CONFLICT' : 'CHAT_ADMIN_INVALID', statusCode })
const value = (input, max = 100) => String(input || '').trim().slice(0, max)
const page = input => Math.min(100000, Math.max(1, Math.trunc(Number(input) || 1)))
const person = a => ({ id: a.id, name: a.name || '已删除账号', username: a.username || '', department: a.department || '', status: a.status || 'unknown', schoolIdentityVerified: a.schoolIdentityVerified === true })

// Oversight is separate from participant access; being an admin never makes one a chat member.
export class ChatAdminService {
  constructor(chat) { this.chat = chat }
  accounts() { return this.chat.accounts.read(d => new Map(d.accounts.map(a => [a.id, person(a)]))) }
  find(d, id) { const c = d.conversations.find(c => c.id === id); if (!c) throw fail('会话不存在', 404); return c }
  view(d, c, people, messages = d.messages.filter(m => m.conversationId === c.id)) {
    const participantIds = [...new Set([...c.members.map(m => m.id), c.ownerId, ...messages.map(m => m.senderId)])].filter(Boolean)
    const members = participantIds.map(id => ({ ...(people.get(id) || person({ id })), current: c.members.some(m => m.id === id), owner: id === c.ownerId, role: id === c.ownerId ? 'owner' : c.members.find(m => m.id === id)?.role === 'admin' ? 'admin' : 'member' }))
    const last = messages.at(-1)
    return { id: c.id, type: c.type, title: c.type === 'group' ? c.title : members.map(p => p.name).join(' / '), members, ownerId: c.ownerId || '', groupRevision: c.groupRevision || 0, schoolGroup: c.schoolGroup || null, status: c.status || 'active', revision: c.moderationRevision || 0, messageCount: messages.length, hiddenCount: messages.filter(m => m.status === 'hidden').length, createdAt: c.createdAt, updatedAt: c.updatedAt, lastMessage: last ? (last.status === 'hidden' ? '[消息已隐藏]' : last.text?.slice(0, 80) || { image: '[图片]', file: '[文件]', sticker: '[表情包]' }[last.kind]) : '', moderation: c.moderation || null }
  }
  list(id, query = {}) {
    this.chat.admin(id)
    const q = value(query.query).toLowerCase(), type = value(query.type), status = value(query.status), p = page(query.page), pageSize = 20, people = this.accounts()
    return this.chat.db.read(d => {
      const messagesByConversation = new Map(), uploadNames = new Map(d.uploads.map(u => [u.id, u.name]))
      for (const m of d.messages) { if (!messagesByConversation.has(m.conversationId)) messagesByConversation.set(m.conversationId, []); messagesByConversation.get(m.conversationId).push(m) }
      const matched = q ? new Set(d.messages.filter(m => [m.text, uploadNames.get(m.attachmentId)].some(s => String(s || '').toLowerCase().includes(q))).map(m => m.conversationId)) : null
      const rows = d.conversations.map(c => this.view(d, c, people, messagesByConversation.get(c.id) || [])).filter(c => (!type || c.type === type) && (!status || c.status === status) && (!q || matched.has(c.id) || [c.title, c.id, ...c.members.flatMap(m => [m.name, m.username, m.id])].some(s => s.toLowerCase().includes(q)))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      return { items: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, page: p, pageSize }
    })
  }
  detail(id, cid, query = {}) {
    this.chat.admin(id)
    const people = this.accounts(), q = value(query.query).toLowerCase(), p = page(query.page), pageSize = 30
    const date = (v, end) => { if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw fail('日期格式无效'); return `${v}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00` }
    const from = date(query.from), to = date(query.to, true)
    if (from && to && Date.parse(from) > Date.parse(to)) throw fail('开始日期不能晚于结束日期')
    return this.chat.db.read(d => {
      const c = this.find(d, cid)
      const rows = d.messages.filter(m => m.conversationId === cid && (!query.kind || m.kind === query.kind) && (!query.status || (m.status || 'visible') === query.status) && (!query.senderId || m.senderId === query.senderId) && (!from || Date.parse(m.createdAt) >= Date.parse(from)) && (!to || Date.parse(m.createdAt) <= Date.parse(to)) && (!q || [m.text, people.get(m.senderId)?.name, people.get(m.senderId)?.username, d.uploads.find(u => u.id === m.attachmentId)?.name].some(s => String(s || '').toLowerCase().includes(q)))).sort((a,b) => b.seq - a.seq)
      return { conversation: this.view(d, c, people), items: rows.slice((p - 1) * pageSize, p * pageSize).map(m => ({ ...this.chat.messageView(d, m, id, true), sender: people.get(m.senderId) || person({ id: m.senderId }), status: m.status || 'visible', revision: m.moderationRevision || 0, trace: m.trace || null, moderation: m.moderation || null })), total: rows.length, page: p, pageSize, history: (d.chatModerationEvents || []).filter(e => e.conversationId === cid).slice(-100).reverse() }
    })
  }
  async moderate(id, cid, mid, input, trace) {
    this.chat.admin(id)
    const statuses = mid ? ['visible','hidden'] : ['active','paused']
    if (!statuses.includes(input.status)) throw fail('处理状态无效')
    if (typeof input.reason !== 'string' || input.reason.trim().length < 2 || input.reason.length > 500) throw fail('请填写2至500字的处理原因')
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw fail('缺少有效记录版本，请刷新后重试')
    return this.chat.db.transaction(d => {
      const actor = person(this.chat.admin(id)), c = this.find(d, cid), target = mid ? d.messages.find(m => m.id === mid && m.conversationId === cid) : c
      if (!target) throw fail('消息不存在', 404)
      if (!mid && (c.status === 'dissolved' || c.dissolvedAt)) throw fail('该自建群已由群主解散，保留历史但不能重新启用', 409)
      if ((target.moderationRevision || 0) !== input.revision) throw fail('记录已被其他管理员处理，请刷新后重试', 409)
      const previous = target.status || statuses[0]
      if (previous === input.status) throw fail('该记录已经是目标状态，请刷新', 409)
      const event = { id: randomUUID(), conversationId: cid, messageId: mid || '', actor, previous, status: input.status, reason: input.reason.trim(), createdAt: new Date().toISOString(), trace: trace || null }
      target.status = input.status; target.moderation = event
      target.moderationRevision = (target.moderationRevision || 0) + 1
      if (mid) c.moderationRevision = (c.moderationRevision || 0) + 1
      ;(d.chatModerationEvents ||= []).push(event)
      return { status: target.status, revision: target.moderationRevision }
    })
  }
}
