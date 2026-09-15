import test from 'node:test'
import assert from 'node:assert/strict'
import { resourceDefinitions } from '../src/config/resourceDefinitions.js'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { postTopics } from '../../server/src/business/community.js'

const visible = (action, record) => (!action.statuses?.length || action.statuses.includes(record.status))
  && (!action.submissionTypes?.length || action.submissionTypes.includes(record.submissionType))
  && (!action.excludedSubmissionTypes?.length || !action.excludedSubmissionTypes.includes(record.submissionType))

test('后台发言下架需原因与版本，业务申请无上下架按钮，历史办理中发言可继续处理', () => {
  const actions = resourceDefinitions.applications.actions
  for (const submissionType of ['organization-message', 'community-comment']) {
    const publishedActions = actions.filter((action) => visible(action, { submissionType, status: 'published' }))
    assert.deepEqual(publishedActions.map((action) => action.key), ['unpublish'])
    assert.equal(publishedActions[0].requiresReason, true)
    assert.equal(publishedActions[0].includeExpectedRevision, true)
    assert.deepEqual(actions.filter((action) => visible(action, { submissionType, status: 'processing' })).map((action) => action.key), ['approve', 'reject'])
  }
  for (const submissionType of ['organization-membership', 'giving-intent', 'event-registration']) {
    for (const status of ['published', 'offline', 'approved', 'completed']) {
      assert.equal(actions.some((action) => ['publish', 'unpublish'].includes(action.key) && visible(action, { submissionType, status })), false)
    }
  }
  assert.equal(resourceDefinitions.community.actions.find((action) => action.key === 'unpublish').requiresReason, true)
})

test('后台详情与编辑兼容旧单话题字段，不会无意清空历史话题', async () => {
  const source = await fs.readFile(new URL('../src/components/ResourceDrawer.vue', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('function recordValue('), source.indexOf('function fieldReadonly('))
  const context = { props: { config: resourceDefinitions.community }, postTopics }
  vm.runInNewContext(`${fn}\nglobalThis.read = recordValue`, context)
  assert.deepEqual(context.read({ topic: '校园记忆' }, 'topics'), ['校园记忆'])
  assert.deepEqual(context.read({ topics: ['摄影', '散步'], topic: '摄影' }, 'topics'), ['摄影', '散步'])
  assert.deepEqual(context.read({ topics: [], topic: '已清空' }, 'topics'), [])
})
