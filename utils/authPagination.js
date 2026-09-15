import { getAccessToken } from './store'
import { loadAllPages as collectPages } from './pagination'

// Every page in a client-filtered catalogue must belong to the same session.
export function loadAllPages(fetchPage, query = {}, stillCurrent = () => true) {
  const token = getAccessToken()
  return collectPages(fetchPage, query, () => token === getAccessToken() && stillCurrent())
}
