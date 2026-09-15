import { request } from './http'
import {
  saveConflictSession,
  saveRegistrationVerification
} from '../utils/store'

const trackingStorageKey = 'hufe_manual_verification_tracking'

function normalizeTracking(value = {}) {
  return {
    applicationId: String(value.applicationId || value.id || ''),
    trackingToken: String(value.trackingToken || value.token || ''),
    status: String(value.status || ''),
    expiresAt: String(value.trackingExpiresAt || value.expiresAt || ''),
    savedAt: new Date().toISOString()
  }
}

export function readManualVerificationTracking() {
  try {
    const stored = uni.getStorageSync(trackingStorageKey)
    if (!stored || typeof stored !== 'object') return null
    const tracking = normalizeTracking(stored)
    if (tracking.expiresAt && new Date(tracking.expiresAt).getTime() <= Date.now()) {
      uni.removeStorageSync(trackingStorageKey)
      return null
    }
    return tracking
  } catch {
    return null
  }
}

export function saveManualVerificationTracking(value = {}) {
  const tracking = normalizeTracking(value)
  if (!tracking.applicationId || !tracking.trackingToken) return null
  uni.setStorageSync(trackingStorageKey, tracking)
  return tracking
}

export function clearManualVerificationTracking() {
  uni.removeStorageSync(trackingStorageKey)
}

export async function createManualVerificationDraft(payload) {
  const response = await request({
    path: '/api/v1/auth/manual-verification/applications',
    method: 'POST',
    token: '',
    data: payload
  })
  const application = response.application || response
  const result = {
    ...application,
    applicationId: application.applicationId || application.id,
    trackingToken: response.trackingToken || application.trackingToken
  }
  saveManualVerificationTracking(result)
  return result
}

export function uploadManualVerificationMaterial(applicationId, trackingToken, material) {
  return request({
    path: `/api/v1/auth/manual-verification/applications/${encodeURIComponent(applicationId)}/materials`,
    method: 'POST',
    token: trackingToken,
    timeout: 30000,
    data: material
  })
}

export function submitManualVerificationApplication(applicationId, trackingToken, payload = {}) {
  return request({
    path: `/api/v1/auth/manual-verification/applications/${encodeURIComponent(applicationId)}/submit`,
    method: 'POST',
    token: trackingToken,
    data: payload
  })
}

export function cancelManualVerificationApplication(applicationId, trackingToken, payload = {}) {
  return request({
    path: `/api/v1/auth/manual-verification/applications/${encodeURIComponent(applicationId)}/cancel`,
    method: 'POST',
    token: trackingToken,
    data: payload
  })
}

export function getManualVerificationApplication(applicationId, trackingToken) {
  return request({
    path: `/api/v1/auth/manual-verification/applications/${encodeURIComponent(applicationId)}`,
    token: trackingToken
  })
}

export function exchangeManualVerificationApplication(applicationId, trackingToken) {
  return request({
    path: `/api/v1/auth/manual-verification/applications/${encodeURIComponent(applicationId)}/exchange`,
    method: 'POST',
    token: trackingToken,
    data: {}
  })
}

export function applyManualVerificationExchange(result = {}) {
  if (result.status === 'account_conflict') {
    saveConflictSession(
      { ...(result.conflict || {}), context: 'registration', verifiedIdentity: result.identity || result.verifiedIdentity || null },
      result.conflictToken,
      result.expiresAt
    )
    return result
  }
  if (result.status === 'registration_verified') {
    saveRegistrationVerification({
      status: 'registration_verified',
      registrationToken: result.registrationToken || result.registrationTicket || '',
      registrationTicket: result.registrationTicket || result.registrationToken || '',
      identity: result.identity || result.verifiedIdentity || null,
      expiresAt: result.expiresAt || '',
      verificationSource: 'manual-review'
    })
    uni.$emit('hufe-registration-changed', result)
  }
  return result
}
