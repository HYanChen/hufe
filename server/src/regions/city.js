// Existing records retain their original names; compare city aliases consistently.
export const cityKey = value => String(value ?? '').trim().toLowerCase().replace(/市$/u, '')
export function cityLabels(values) {
  const map = new Map()
  for (const value of values) { const key = cityKey(value); if (key && (!map.has(key) || String(value).endsWith('市'))) map.set(key, value) }
  return [...map.values()]
}
