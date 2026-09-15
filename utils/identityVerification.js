// 兼容既有人工复核与管理员明确确认，避免将人工结论显示成学校接口回传。
export function isManualVerification(user = {}) {
  return user.schoolIdentityVerified === true
    && ['manual-identity-review', 'platform-admin-confirmed', 'admin-personnel-review'].includes(user.verificationSource)
}

export function manualVerificationDescription(user = {}) {
  return user.verificationSource === 'platform-admin-confirmed'
    ? '身份校验已通过，资料由平台管理员人工确认。'
    : '身份校验已通过，资料已完成人工复核。'
}
