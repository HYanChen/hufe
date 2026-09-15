// Presentation uses the authoritative affiliation fields, never guesses by splitting names.
export function conversationTitle(conversation) {
  const group = conversation?.schoolGroup
  if (group) {
    const value = group.kind === 'major' ? group.major
      : group.kind === 'class' ? group.className
        : ['college', 'department'].includes(group.kind) ? group.department || group.college : ''
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return conversation?.title || '对话'
}
export function isFixedGroup(conversation) {
  return conversation?.type === 'group' && Boolean(conversation.schoolGroup)
}
export function canLeaveGroup(conversation, selfId) {
  return conversation?.type === 'group' && !isFixedGroup(conversation)
    && conversation.status !== 'dissolved' && Boolean(selfId) && conversation.ownerId !== selfId
    && conversation.permissions?.leave === true
}
export function canDissolveGroup(conversation, selfId) {
  return conversation?.type === 'group' && !isFixedGroup(conversation)
    && conversation.status !== 'dissolved' && Boolean(selfId) && conversation.ownerId === selfId
    && conversation.permissions?.dissolve === true
}
