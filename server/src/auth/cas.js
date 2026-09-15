import { XMLParser } from 'fast-xml-parser'
import { assertSchoolEndpoint } from './settings.js'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false
})

function flatValue(value) {
  if (Array.isArray(value)) return value.flatMap(flatValue)
  if (value && typeof value === 'object') return Object.values(value).flatMap(flatValue)
  return value == null ? '' : String(value)
}

export function parseCasResponse(xml) {
  const parsed = xmlParser.parse(xml)
  const response = parsed?.serviceResponse
  if (!response) throw new Error('CAS 返回格式无效')
  if (response.authenticationFailure) {
    const failure = response.authenticationFailure
    const message = typeof failure === 'string' ? failure : (failure['#text'] || 'CAS 票据校验失败')
    const error = new Error(message)
    error.code = failure['@_code'] || 'CAS_VALIDATION_FAILED'
    throw error
  }

  const success = response.authenticationSuccess
  if (!success?.user) throw new Error('CAS 返回缺少用户标识')
  const attributes = {}
  for (const [key, value] of Object.entries(success.attributes || {})) attributes[key] = flatValue(value)
  return { subject: String(success.user), claims: { ...attributes, sub: String(success.user) }, raw: success }
}

export class CasClient {
  constructor(config) {
    this.config = config
  }

  loginUrl(serviceUrl) {
    const url = new URL(`${this.config.baseUrl}${this.config.loginPath}`)
    url.searchParams.set('service', serviceUrl)
    return url.toString()
  }

  async validate(ticket, serviceUrl) {
    const url = new URL(`${this.config.baseUrl}${this.config.validatePath}`)
    if (this.config.allowedHosts) assertSchoolEndpoint(url.toString(), this.config.allowedHosts)
    url.searchParams.set('service', serviceUrl)
    url.searchParams.set('ticket', ticket)
    const response = await fetch(url, {
      redirect: 'error',
      headers: { accept: 'application/xml,text/xml' },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    })
    if (!response.ok) throw new Error(`CAS 校验接口返回 HTTP ${response.status}`)
    return parseCasResponse(await response.text())
  }
}
