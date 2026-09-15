import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { developmentBusinessSeeds } from '../src/business/seeds.js'

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {},
    startScheduler() {},
    stopScheduler() {},
    status: () => status,
    home: () => ({ status, sections: {} }),
    list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null,
    refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-academic-calendar-test-'))
  const config = createConfig({
    env: 'test',
    dataFile: path.join(directory, 'data.json'),
    mediaDir: path.join(directory, 'media'),
    dataHashSecret: 'academic-calendar-flow-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({
    config,
    logger: false,
    refreshContent: false,
    scheduleContent: false,
    contentService: contentStub()
  })
  t.after(async () => {
    await app.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const register = (schoolSubject, username, name, personType, isAdmin = false) =>
    app.services.accounts.register({
      schoolSubject,
      name,
      personType,
      department: isAdmin ? '教务管理部门' : '财政金融学院',
      verificationSource: 'school-registration-check',
      isAdmin
    }, { username, password: 'StrongPass!2026' })

  await register('calendar-admin', 'calendar_admin', '校历管理员', 'staff', true)
  await register('calendar-alumni', 'calendar_alumni', '校友用户', 'alumni')

  const login = async (username) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: 'StrongPass!2026' }
    })
    assert.equal(response.statusCode, 200)
    return { authorization: `Bearer ${response.json().data.accessToken}` }
  }

  return {
    app,
    adminHeaders: await login('calendar_admin'),
    alumniHeaders: await login('calendar_alumni')
  }
}

function calendarPayload(overrides = {}) {
  return {
    title: '第一学期教学安排',
    academicYear: '2026-2027',
    term: 'first',
    category: 'teaching',
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    weekNumber: 1,
    audience: 'all',
    campus: '主校区',
    summary: '经学校授权后由后台发布的校历事项。',
    sourceUrl: 'https://www.hufe.edu.cn/',
    priority: 'normal',
    sortOrder: 20,
    ...overrides
  }
}

async function createCalendar(app, adminHeaders, payload) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/academic-calendar',
    headers: adminHeaders,
    payload
  })
  assert.equal(response.statusCode, 201, response.body)
  return response.json().data
}

async function calendarAction(app, adminHeaders, id, action) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/business/academic-calendar/${id}/actions`,
    headers: adminHeaders,
    payload: { action }
  })
}

test('学校校历支持受权后台 CRUD、发布筛选、排序与下架', async (t) => {
  const { app, adminHeaders, alumniHeaders } = await fixture(t)

  const delegationResources = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/delegation/resources',
    headers: adminHeaders
  })
  assert.equal(delegationResources.statusCode, 200)
  assert.deepEqual(
    delegationResources.json().data.items.find((item) => item.key === 'academic-calendar'),
    { key: 'academic-calendar', label: '学校校历' }
  )

  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/business/academic-calendar',
    headers: alumniHeaders,
    payload: calendarPayload()
  })
  assert.equal(forbidden.statusCode, 403)

  const later = await createCalendar(app, adminHeaders, calendarPayload({
    title: '第二周教学安排',
    startDate: '2026-09-08',
    endDate: '2026-09-14',
    weekNumber: 2,
    sortOrder: -100
  }))
  assert.equal(later.status, 'draft')

  const earlier = await createCalendar(app, adminHeaders, calendarPayload())
  const earlierSecondary = await createCalendar(app, adminHeaders, calendarPayload({
    title: '第一周补充安排',
    sortOrder: 30
  }))
  const hidden = await app.inject({ method: 'GET', url: '/api/v1/business/academic-calendar' })
  assert.equal(hidden.statusCode, 200)
  assert.equal(hidden.json().data.total, 0)

  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/business/academic-calendar/${earlier.id}`,
    headers: adminHeaders,
    payload: {
      expectedRevision: earlier.revision,
      summary: '校历事项更新后仍须重新核对再发布。'
    }
  })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().data.revision, earlier.revision + 1)

  for (const item of [later, earlierSecondary, updated.json().data]) {
    const published = await calendarAction(app, adminHeaders, item.id, 'publish')
    assert.equal(published.statusCode, 200, published.body)
    assert.equal(published.json().data.status, 'published')
  }

  const visible = await app.inject({
    method: 'GET',
    url: '/api/v1/business/academic-calendar?academicYear=2026-2027&term=first&category=teaching&priority=normal'
  })
  assert.equal(visible.statusCode, 200)
  assert.equal(visible.json().data.total, 3)
  assert.deepEqual(
    visible.json().data.items.map((item) => item.id),
    [earlier.id, earlierSecondary.id, later.id]
  )

  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/academic-calendar/${earlier.id}`
  })
  assert.equal(detail.statusCode, 200)
  assert.equal(detail.json().data.summary, '校历事项更新后仍须重新核对再发布。')

  const alumniOnly = await createCalendar(app, adminHeaders, calendarPayload({
    title: '校友返校活动（测试）',
    category: 'activity',
    startDate: '2026-10-01',
    endDate: '2026-10-01',
    weekNumber: null,
    audience: 'alumni',
    priority: 'important',
    sortOrder: 10
  }))
  assert.equal((await calendarAction(app, adminHeaders, alumniOnly.id, 'publish')).statusCode, 200)

  const anonymousAudience = await app.inject({
    method: 'GET',
    url: '/api/v1/business/academic-calendar?audience=alumni'
  })
  assert.equal(anonymousAudience.json().data.total, 0)
  const alumniAudience = await app.inject({
    method: 'GET',
    url: '/api/v1/business/academic-calendar?audience=alumni',
    headers: alumniHeaders
  })
  assert.equal(alumniAudience.json().data.total, 1)
  assert.equal(alumniAudience.json().data.items[0].id, alumniOnly.id)

  const bootstrap = await app.inject({
    method: 'GET',
    url: '/api/v1/business/bootstrap',
    headers: alumniHeaders
  })
  assert.equal(bootstrap.statusCode, 200)
  assert.equal(bootstrap.json().data.academicCalendar.some((item) => item.id === alumniOnly.id), true)

  const unsupportedAction = await calendarAction(app, adminHeaders, later.id, 'complete')
  assert.equal(unsupportedAction.statusCode, 400)
  assert.equal(unsupportedAction.json().code, 'BUSINESS_ACTION_INVALID')

  const offline = await calendarAction(app, adminHeaders, earlier.id, 'unpublish')
  assert.equal(offline.statusCode, 200)
  assert.equal(offline.json().data.status, 'offline')
  const offlineDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/business/academic-calendar/${earlier.id}`
  })
  assert.equal(offlineDetail.statusCode, 404)
})

test('学校校历严格拒绝未知字段、非法枚举、学年、周次与倒置日期', async (t) => {
  const { app, adminHeaders } = await fixture(t)
  const cases = [
    {
      payload: calendarPayload({ clientOnlyFlag: true }),
      code: 'BUSINESS_FIELD_UNKNOWN'
    },
    {
      payload: calendarPayload({ term: 'autumn' }),
      code: 'BUSINESS_FIELD_INVALID'
    },
    {
      payload: calendarPayload({ category: 'meeting' }),
      code: 'BUSINESS_FIELD_INVALID'
    },
    {
      payload: calendarPayload({ academicYear: '2026/2027' }),
      code: 'BUSINESS_FIELD_INVALID'
    },
    {
      payload: calendarPayload({ academicYear: '2026-2028' }),
      code: 'BUSINESS_FIELD_INVALID'
    },
    {
      payload: calendarPayload({ weekNumber: 0 }),
      code: 'BUSINESS_FIELD_INVALID'
    },
    {
      payload: calendarPayload({ summary: '' }),
      code: 'BUSINESS_FIELD_REQUIRED'
    },
    {
      payload: calendarPayload({ startDate: '2026-09-08', endDate: '2026-09-01' }),
      code: 'BUSINESS_DATE_ORDER_INVALID'
    },
    {
      payload: calendarPayload({ status: 'published' }),
      code: 'BUSINESS_PROTECTED_FIELD'
    }
  ]

  for (const item of cases) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/business/academic-calendar',
      headers: adminHeaders,
      payload: item.payload
    })
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(response.json().code, item.code)
  }
})

test('开发种子仅提供明确标注的校历演示数据与安全入口', () => {
  const seeds = developmentBusinessSeeds()
  const calendar = seeds['academic-calendar']
  assert.equal(Array.isArray(calendar), true)
  assert.equal(calendar.length, 1)
  assert.equal(calendar[0].resource, 'academic-calendar')
  assert.equal(calendar[0].status, 'published')
  assert.match(calendar[0].title, /开发示例/u)
  assert.match(calendar[0].summary, /不代表学校正式校历日期/u)
  assert.equal(calendar[0].academicYear, '2099-2100')

  const serviceEntry = seeds['service-catalog'].find((item) => item.route === '/pages/calendar/index')
  assert.ok(serviceEntry)
  assert.match(serviceEntry.title, /开发示例入口/u)
  assert.match(serviceEntry.summary, /正式日期以学校授权发布内容为准/u)
})
