import { request } from './http'
import { applyModuleConfig } from './modules'
export const lookupEnterpriseByName = name => request({path:'/api/v1/enterprise-lookup',method:'POST',data:{name}})

export const businessResources = Object.freeze({
  community: 'community-posts',
  services: 'service-catalog',
  activities: 'activities',
  organizations: 'organizations',
  directory: 'directory',
  jobs: 'jobs',
  mentors: 'mentors',
  volunteers: 'volunteers',
  giving: 'giving-projects',
  home: 'home-config',
  enterprises: 'alumni-enterprises',
  collaboration: 'collaboration-opportunities',
  academy: 'alumni-academy',
  benefits: 'alumni-benefits',
  announcements: 'announcements',
  academicCalendar: 'academic-calendar'
})

export const submissionTypes = Object.freeze({
  eventRegistrations: 'event-registration',
  visitApplications: 'campus-visit',
  chapterMemberships: 'organization-membership',
  jobApplications: 'job-application',
  jobFavorites: 'job-favorite',
  mentorApplications: 'mentor-application',
  volunteerApplications: 'volunteer-application',
  givingIntents: 'giving-intent',
  feedback: 'feedback',
  serviceApplications: 'service-application',
  newsFavorites: 'news-favorite',
  communityComments: 'community-comment',
  communityReports: 'community-report',
  benefitClaims: 'benefit-claim'
})

const publicResources = new Set(Object.values(businessResources))
const resourceIdAliases = Object.freeze({
  'event-registration': 'activityId',
  'organization-membership': 'organizationId',
  'job-application': 'jobId',
  'mentor-application': 'mentorId',
  'volunteer-application': 'volunteerId',
  'giving-intent': 'projectId',
  'benefit-claim': 'benefitId'
})

function publicResourcePath(resource) {
  if (!publicResources.has(resource)) throw new Error(`不支持的业务资源：${resource}`)
  return `/api/v1/business/${resource}`
}

export function normalizeList(result) {
  if (Array.isArray(result)) return { items: result, total: result.length, page: 1, pageSize: result.length, revision: 0 }
  return {
    ...(result || {}),
    items: Array.isArray(result?.items) ? result.items : [],
    total: Number(result?.total ?? result?.items?.length ?? 0),
    page: Number(result?.page || 1),
    pageSize: Number(result?.pageSize || result?.items?.length || 0)
  }
}

function normalizeSubmission(item = {}) {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {}
  const normalized = { ...payload, ...item, payload }
  // A certificate is a server-issued record, never a user-supplied payload field.
  // Keep it only when the submission resource itself carries the certificate.
  if (!Object.prototype.hasOwnProperty.call(item, 'certificate')) delete normalized.certificate
  const alias = resourceIdAliases[item.type]
  if (alias && !normalized[alias]) normalized[alias] = item.resourceId
  return normalized
}

async function listMySubmissions(type, query = {}, token) {
  const result = normalizeList(await request({
    path: '/api/v1/business/me/submissions',
    data: { ...query, type }, token
  }))
  return { ...result, items: result.items.map(normalizeSubmission) }
}

function createSubmission(type, resourceId, payload = {}) {
  return request({
    path: '/api/v1/business/submissions',
    method: 'POST',
    data: { type, resourceId: resourceId || '', payload }
  }).then(normalizeSubmission)
}

function cancelSubmission(id, token) {
  return request({
    path: `/api/v1/business/me/submissions/${encodeURIComponent(id)}/cancel`,
    method: 'PATCH',
    token
  }).then(normalizeSubmission)
}

export async function listBusiness(resource, query = {}) {
  return normalizeList(await request({ path: publicResourcePath(resource), data: query }))
}

export function getBusinessDetail(resource, id) {
  return request({ path: `${publicResourcePath(resource)}/${encodeURIComponent(id)}` })
}

export async function getHomeOperations() {
  const result = await request({ path: '/api/v1/business/bootstrap' })
  applyModuleConfig(result.modules)
  return {
    ...result,
    sections: Array.isArray(result?.homeConfig) ? result.homeConfig : [],
    services: Array.isArray(result?.serviceCatalog) ? result.serviceCatalog : []
  }
}

export function getServiceCatalog() {
  return listBusiness(businessResources.services, { page: 1, pageSize: 100 })
}

export function getCommunityPosts(query = {}) {
  return listBusiness(businessResources.community, query)
}

export function searchCommunityPeople(query) { return request({ path: '/api/v1/business/community-people', data: { query } }) }

export function getCommunityComments(id, query = {}) {
  return request({ path: `/api/v1/business/community-posts/${encodeURIComponent(id)}/comments`, data: query }).then(normalizeList)
}

export function submitCommunityComment(id, content, options = {}) {
  return request({ path: `/api/v1/business/community-posts/${encodeURIComponent(id)}/comments`, method: 'POST', data: { content, anonymous: options.anonymous === true } })
}

export function withdrawCommunityComment(id) { return cancelSubmission(id) }

export function publishCommunityPost(payload) {
  return request({ path: '/api/v1/business/community-posts', method: 'POST', data: payload })
}

export function toggleCommunityLike(id) {
  return request({ path: `/api/v1/business/community-posts/${encodeURIComponent(id)}/like`, method: 'POST' })
}

export function getActivities(query = {}) {
  return listBusiness(businessResources.activities, query)
}

export function getActivity(id) {
  return getBusinessDetail(businessResources.activities, id)
}

export function getMyActivityRegistrations() {
  return listMySubmissions(submissionTypes.eventRegistrations, { page: 1, pageSize: 100 })
}

export function registerForActivity(activityId, payload = {}) {
  return createSubmission(submissionTypes.eventRegistrations, activityId, payload)
}

export function cancelActivityRegistration(registrationId) {
  return cancelSubmission(registrationId)
}

export function getCampusVisits() {
  return listMySubmissions(submissionTypes.visitApplications, { page: 1, pageSize: 100 })
}

export function createCampusVisit(payload) {
  return createSubmission(submissionTypes.visitApplications, '', payload)
}

export function cancelCampusVisit(id) {
  return cancelSubmission(id)
}

export function getOrganizations(query = {}) {
  return listBusiness(businessResources.organizations, query)
}

export function getOrganizationHome(organizationId) {
  return request({
    path: `/api/v1/business/organizations/${encodeURIComponent(organizationId)}/home`
  })
}

export function getMyOrganizationMemberships() {
  return listMySubmissions(submissionTypes.chapterMemberships, { page: 1, pageSize: 100 })
}

export async function getOrganizationMembers(organizationId, query = {}) {
  return normalizeList(await request({
    path: `/api/v1/business/organizations/${encodeURIComponent(organizationId)}/members`,
    data: query
  }))
}

export async function getOrganizationMessages(organizationId, query = {}) {
  return normalizeList(await request({ path: `/api/v1/business/organizations/${encodeURIComponent(organizationId)}/messages`, data: query }))
}

export function createOrganizationMessage(organizationId, content) {
  return request({ path: `/api/v1/business/organizations/${encodeURIComponent(organizationId)}/messages`, method: 'POST', data: { content } })
}

export function cancelOrganizationMessage(id) { return cancelSubmission(id) }

export function getOrganizationContact(organizationId) {
  return request({ path: `/api/v1/business/organizations/${encodeURIComponent(organizationId)}/contact` })
}

export function joinOrganization(organizationId, message = '') {
  return createSubmission(submissionTypes.chapterMemberships, organizationId, { message })
}

export function endOrganizationMembership(membershipId, token) {
  return cancelSubmission(membershipId, token)
}

export async function getMyManagedOrganizations(query = {}) {
  return normalizeList(await request({
    path: '/api/v1/business/me/managed-organizations',
    data: { page: 1, pageSize: 100, ...query }
  }))
}

export function getMyManagedOrganization(organizationId) {
  return request({
    path: `/api/v1/business/me/managed-organizations/${encodeURIComponent(organizationId)}`
  })
}

export function publishManagedOrganizationActivity(organizationId, payload) {
  return request({
    path: `/api/v1/business/me/managed-organizations/${encodeURIComponent(organizationId)}/activities`,
    method: 'POST',
    data: payload
  })
}

export function publishManagedOrganizationAnnouncement(organizationId, payload) {
  return request({
    path: `/api/v1/business/me/managed-organizations/${encodeURIComponent(organizationId)}/announcements`,
    method: 'POST',
    // Organization announcements do not target another business resource. Keep
    // this server-required field out of the editor so it cannot be tampered with.
    data: { ...(payload || {}), targetType: 'none' }
  })
}

export function updateManagedOrganizationActivity(organizationId, activityId, payload) {
  return request({
    path: `/api/v1/business/me/managed-organizations/${encodeURIComponent(organizationId)}/activities/${encodeURIComponent(activityId)}`,
    method: 'PATCH',
    data: payload
  })
}

export function updateManagedOrganizationAnnouncement(organizationId, announcementId, payload) {
  return request({
    path: `/api/v1/business/me/managed-organizations/${encodeURIComponent(organizationId)}/announcements/${encodeURIComponent(announcementId)}`,
    method: 'PATCH',
    data: { ...(payload || {}), targetType: 'none' }
  })
}

export function actManagedOrganizationContent(organizationId, resource, contentId, action) {
  const resourcePath = resource === 'announcement' ? 'announcements' : 'activities'
  return request({
    path: `/api/v1/business/me/managed-organizations/${encodeURIComponent(organizationId)}/${resourcePath}/${encodeURIComponent(contentId)}/actions`,
    method: 'POST',
    data: { action }
  })
}

export function getDirectory(query = {}) {
  return listBusiness(businessResources.directory, query)
}

export function getJobs(query = {}) {
  return listBusiness(businessResources.jobs, query)
}

export function getMyJobApplications(query = {}) {
  return listMySubmissions(submissionTypes.jobApplications, { page: 1, pageSize: 100, ...query })
}

export function applyForJob(id, payload = {}) {
  return createSubmission(submissionTypes.jobApplications, id, payload)
}

export function getMentors(query = {}) {
  return listBusiness(businessResources.mentors, query)
}

export function getMyMentorApplications() {
  return listMySubmissions(submissionTypes.mentorApplications, { page: 1, pageSize: 100 })
}

export function applyForMentor(id, payload = {}) {
  return createSubmission(submissionTypes.mentorApplications, id, payload)
}

export function getMyMentorProfile() {
  return request({ path: '/api/v1/business/me/mentor-profile' })
}

export function saveMyMentorProfile(payload) {
  return request({
    path: '/api/v1/business/me/mentor-profile',
    method: 'PUT',
    data: payload
  })
}

export function getAlumniEnterprises(query = {}) {
  return listBusiness(businessResources.enterprises, query)
}

export function getMyEnterpriseProfile() {
  return request({ path: '/api/v1/business/me/enterprise-profile' })
}

export function uploadEnterpriseCertificationMaterial(material) {
  return request({
    path: '/api/v1/business/enterprise-certifications/materials',
    method: 'POST',
    timeout: 30000,
    data: {
      filename: material.filename,
      mimeType: material.mimeType,
      dataBase64: material.dataBase64,
      fileSource: material.fileSource,
      materialType: material.materialType
    }
  })
}

export function deleteEnterpriseCertificationMaterial(materialId) {
  return request({
    path: `/api/v1/business/enterprise-certifications/materials/${encodeURIComponent(materialId)}`,
    method: 'DELETE'
  })
}

export function submitEnterpriseCertification(payload) {
  return request({
    path: '/api/v1/business/enterprise-certifications',
    method: 'POST',
    data: payload
  })
}

export function saveMyEnterpriseProfile(payload) {
  return request({
    path: '/api/v1/business/me/enterprise-profile',
    method: 'PUT',
    data: payload
  })
}

export async function getMyEnterpriseJobs(query = {}) {
  return normalizeList(await request({
    path: '/api/v1/business/me/jobs',
    data: query
  }))
}

export function createMyEnterpriseJob(payload) {
  return request({
    path: '/api/v1/business/me/jobs',
    method: 'POST',
    data: payload
  })
}

export function updateMyEnterpriseJob(id, payload) {
  return request({
    path: `/api/v1/business/me/jobs/${encodeURIComponent(id)}`,
    method: 'PUT',
    data: payload
  })
}

export function cancelMyEnterpriseJob(id, payload = {}) {
  return request({
    path: `/api/v1/business/me/jobs/${encodeURIComponent(id)}/cancel`,
    method: 'PATCH',
    data: payload
  })
}

export function getCollaborationOpportunities(query = {}) {
  return listBusiness(businessResources.collaboration, query)
}

export async function getMyCollaborationOpportunities(query = {}) {
  return normalizeList(await request({
    path: '/api/v1/business/me/collaboration-opportunities',
    data: query
  }))
}

export function publishCollaborationOpportunity(payload) {
  return request({
    path: '/api/v1/business/collaboration-opportunities',
    method: 'POST',
    data: payload
  })
}

export function cancelMyCollaborationOpportunity(id) {
  return request({
    path: `/api/v1/business/me/collaboration-opportunities/${encodeURIComponent(id)}/cancel`,
    method: 'PATCH'
  })
}

export function getAlumniAcademy(query = {}) {
  return listBusiness(businessResources.academy, query)
}

export function getAlumniBenefits(query = {}) {
  return listBusiness(businessResources.benefits, query)
}

export function getAnnouncements(query = {}) {
  return listBusiness(businessResources.announcements, query)
}

export function getCommunityHighlights() {
  return request({ path: '/api/v1/business/community-highlights' })
}

export function getAcademicCalendar(query = {}) {
  return listBusiness(businessResources.academicCalendar, query)
}

export function getMyBenefitClaims(query = {}) {
  return listMySubmissions(submissionTypes.benefitClaims, { page: 1, pageSize: 100, ...query })
}

export function claimAlumniBenefit(benefitId, payload = {}) {
  return createSubmission(submissionTypes.benefitClaims, benefitId, payload)
}

export async function getMyInbox(query = {}, options = {}) {
  const result = await request({
    path: '/api/v1/business/me/inbox',
    data: query,
    token: options.token
  })
  const normalized = normalizeList(result)
  return {
    ...normalized,
    unread: Number(result?.unread ?? result?.unreadCount ?? normalized.items.filter((item) => !item.readAt && item.read !== true).length)
  }
}

export function markInboxMessageRead(id) {
  return request({
    path: `/api/v1/business/me/inbox/${encodeURIComponent(id)}/read`,
    method: 'PATCH'
  })
}

export function markAllInboxMessagesRead() {
  return request({
    path: '/api/v1/business/me/inbox/read-all',
    method: 'POST'
  })
}

export async function getDirectoryCityStats() {
  const result = await request({ path: '/api/v1/business/directory/city-stats' })
  if (Array.isArray(result)) return { items: result, total: result.length }
  const items = Array.isArray(result?.items) ? result.items : (Array.isArray(result?.cities) ? result.cities : [])
  return { ...(result || {}), items, total: Number(result?.total ?? items.length) }
}

export function getDirectoryCityCenter(city) {
  return request({ path: `/api/v1/business/directory/city-center?city=${encodeURIComponent(city)}` })
}

export function getVolunteerProjects(query = {}) {
  return listBusiness(businessResources.volunteers, query)
}

export function getMyVolunteerApplications() {
  return listMySubmissions(submissionTypes.volunteerApplications, { page: 1, pageSize: 100 })
}

export function applyForVolunteer(id, payload = {}) {
  return createSubmission(submissionTypes.volunteerApplications, id, payload)
}

export function getGivingProjects(query = {}) {
  return listBusiness(businessResources.giving, query)
}

export function getMyGivingIntents(query = {}, token) {
  return listMySubmissions(submissionTypes.givingIntents, { page: 1, pageSize: 100, ...query }, token)
}

export function submitGivingIntent(payload = {}) {
  const { projectId, ...details } = payload
  return createSubmission(submissionTypes.givingIntents, projectId, details)
}

export function getMyFeedback() {
  return listMySubmissions(submissionTypes.feedback, { page: 1, pageSize: 100 })
}

export function submitFeedback(payload) {
  return createSubmission(submissionTypes.feedback, '', payload)
}

export function getMyDashboardSummary() {
  return request({ path: '/api/v1/business/me/summary' }).then((result) => ({
    activities: Number(result?.activityRegistrations || 0),
    posts: Number(result?.posts || 0),
    collaborations: Number(result?.collaborations || 0),
    organizations: Number(result?.organizations || 0),
    applications: Number(result?.applications || 0),
    pending: Number(result?.pending || 0),
    benefits: Number(result?.benefitClaims ?? result?.benefits ?? 0),
    inbox: Number(result?.unreadInbox ?? result?.inboxUnread ?? result?.inbox ?? 0)
  }))
}
