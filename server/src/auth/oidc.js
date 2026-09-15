import { createRemoteJWKSet, jwtVerify } from 'jose'
import { codeChallenge, randomToken } from './crypto.js'
import { assertSchoolEndpoint } from './settings.js'

export class OidcClient {
  constructor(config) {
    this.config = config
    this.discovery = null
    this.jwks = null
  }

  async discover() {
    if (this.discovery) return this.discovery
    const url = `${this.config.issuer}/oidc/.well-known/openid-configuration`
    if (this.config.allowedHosts) assertSchoolEndpoint(url, this.config.allowedHosts)
    const response = await fetch(url, {
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    })
    if (!response.ok) throw new Error(`OIDC Discovery 返回 HTTP ${response.status}`)
    const discovery = await response.json()
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      if (!discovery[key]) throw new Error(`OIDC Discovery 缺少 ${key}`)
    }
    if (discovery.issuer !== this.config.issuer) throw new Error('OIDC issuer 与配置不一致')
    if (this.config.allowedHosts) {
      for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint']) {
        if (discovery[key]) assertSchoolEndpoint(discovery[key], this.config.allowedHosts)
      }
    }
    this.discovery = discovery
    this.jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), { timeoutDuration: this.config.requestTimeoutMs })
    return discovery
  }

  async authorization({ redirectUri, state, nonce = randomToken(), codeVerifier = randomToken(48) }) {
    if (!this.config.clientId) throw new Error('OIDC_CLIENT_ID 尚未配置')
    const discovery = await this.discover()
    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', this.config.scopes)
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('code_challenge', codeChallenge(codeVerifier))
    url.searchParams.set('code_challenge_method', 'S256')
    return { url: url.toString(), nonce, codeVerifier }
  }

  async exchange({ code, redirectUri, codeVerifier, nonce }) {
    const discovery = await this.discover()
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      code_verifier: codeVerifier
    })
    const headers = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }
    if (this.config.clientSecret && this.config.tokenAuthMethod === 'client_secret_basic') {
      headers.authorization = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`
    } else if (this.config.clientSecret && this.config.tokenAuthMethod === 'client_secret_post') {
      body.set('client_secret', this.config.clientSecret)
    }

    const response = await fetch(discovery.token_endpoint, {
      method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    })
    const tokenSet = await response.json().catch(() => ({}))
    if (!response.ok || !tokenSet.id_token) throw new Error(tokenSet.error_description || tokenSet.error || `OIDC 换取 token 失败（HTTP ${response.status}）`)

    const verified = await jwtVerify(tokenSet.id_token, this.jwks, {
      issuer: discovery.issuer,
      audience: this.config.clientId
    })
    if (verified.payload.nonce !== nonce) throw new Error('OIDC nonce 校验失败')

    let userInfo = {}
    if (discovery.userinfo_endpoint && tokenSet.access_token) {
      const userResponse = await fetch(discovery.userinfo_endpoint, {
        redirect: 'error',
        headers: { authorization: `Bearer ${tokenSet.access_token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      })
      if (userResponse.ok) userInfo = await userResponse.json()
    }
    const claims = { ...verified.payload, ...userInfo }
    if (claims.sub !== verified.payload.sub) throw new Error('OIDC UserInfo subject 不一致')
    return { subject: String(claims.sub), claims, tokenMeta: { expiresIn: tokenSet.expires_in, scope: tokenSet.scope } }
  }
}
