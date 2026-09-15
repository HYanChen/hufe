import { request } from './http'
export const gateApi = (path = '', options = {}) => request({ path: '/api/v1/gate' + path, ...options })
