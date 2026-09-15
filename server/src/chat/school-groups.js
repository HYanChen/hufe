import { createHash, randomUUID } from 'node:crypto'
import { academicAffiliations } from '../accounts/affiliations.js'

export function schoolGroupProfiles(accounts) {
  return accounts.map(account => ({ id: account.id, affiliations: academicAffiliations(account).filter(a => a.kind !== 'grade') }))
}

export function schoolGroupFingerprint(profiles) {
  return createHash('sha256').update(JSON.stringify(profiles)).digest('hex')
}

export function reconcileSchoolGroups(data, profiles) {
  const expected = new Map(), now = new Date().toISOString()
  for (const person of profiles) for (const affiliation of person.affiliations) {
    if (!expected.has(affiliation.key)) expected.set(affiliation.key, { affiliation, ids: new Set() })
    expected.get(affiliation.key).ids.add(person.id)
  }
  let created = 0, joined = 0, removed = 0, renamed = 0, restoredFixedMemberships = 0
  for (const { affiliation, ids } of expected.values()) {
    let group = data.conversations.find(c => c.schoolGroup?.key === affiliation.key)
    const title = affiliation.kind === 'department' ? affiliation.department : affiliation.kind === 'major' ? affiliation.major : affiliation.className
    if (!group) {
      group = { id: randomUUID(), type: 'group', title, ownerId: '', schoolGroup: affiliation, groupRevision: 0, members: [], excludedIds: [], seq: 0, status: 'active', createdAt: now, updatedAt: now }
      data.conversations.push(group); created++
    } else if (group.title !== title) {
      group.title = title; group.groupRevision = (group.groupRevision || 0) + 1; group.updatedAt = now; renamed++
    }
    for (const id of ids) if (!group.members.some(m => m.id === id)) {
      group.members.push({ id, role: 'member', lastReadSeq: group.seq, joinedSeq: group.seq + 1 })
      group.groupRevision = (group.groupRevision || 0) + 1; group.updatedAt = now; joined++
    }
  }
  for (const group of data.conversations.filter(c => c.schoolGroup)) {
    const eligible = expected.get(group.schoolGroup.key)?.ids || new Set()
    // Fixed academic membership follows verified identity, never historical
    // voluntary exits/removals from the older, opt-out version of the feature.
    if (group.excludedIds?.length) { restoredFixedMemberships += group.excludedIds.length; group.excludedIds = []; group.groupRevision = (group.groupRevision || 0) + 1; group.updatedAt = now }
    const before = group.members.length
    group.members = group.members.filter(m => eligible.has(m.id))
    if (group.members.length !== before) {
      removed += before - group.members.length
      group.groupRevision = (group.groupRevision || 0) + 1; group.updatedAt = now
    }
    if (group.ownerId && !group.members.some(m => m.id === group.ownerId)) group.ownerId = ''
  }
  return { created, joined, removed, renamed, restoredFixedMemberships }
}

export function groupPermissions(conversation, id) {
  const member = conversation.members.find(m => m.id === id)
  const owner = !!member && conversation.ownerId === id
  const dissolved = conversation.status === 'dissolved' || Boolean(conversation.dissolvedAt)
  const manage = !!member && (owner || member.role === 'admin') && conversation.type === 'group' && conversation.status !== 'paused' && !dissolved
  return { manageMembers: manage, addMembers: manage && !conversation.schoolGroup, removeMembers: manage && !conversation.schoolGroup, manageAdmins: owner && manage, rename: manage && !conversation.schoolGroup, leave: !!member && conversation.type === 'group' && !conversation.schoolGroup && (!owner || dissolved), dissolve: owner && conversation.type === 'group' && !conversation.schoolGroup && !dissolved }
}

export function canUseSchoolGroup(account, conversation) {
  return !conversation.schoolGroup || academicAffiliations(account).some(a => a.key === conversation.schoolGroup.key)
}
