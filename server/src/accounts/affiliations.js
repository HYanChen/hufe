import { createHash } from 'node:crypto'

const field = (value, limit) => {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const text = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ')
  return text && text.length <= limit && !/[\u0000-\u001f<>]/.test(text) ? text : ''
}

// Only top-level, school-verified identity attributes determine academic groups.
// Never fall back to personalProfile or parse a year/major out of a class label.
export function academicAffiliations(account) {
  if (account?.status !== 'active' || account.schoolIdentityVerified !== true || !['student', 'alumni'].includes(account.personType)) return []
  const department = field(account.department, 120)
  const major = field(account.major, 120)
  const className = field(account.className, 80)
  const rawYear = field(account.enrollmentYear, 4)
  const enrollmentYear = /^\d{4}$/.test(rawYear) && Number(rawYear) >= 1900 && Number(rawYear) <= 2200 ? rawYear : ''
  const rows = []
  const add = (kind, identity, title, values) => rows.push({ key: `academic:${kind}:${createHash('sha256').update(JSON.stringify([kind, ...identity])).digest('hex')}`, kind, title, department: '', major: '', className: '', enrollmentYear: '', ...values })
  if (department) add('department', [department], `${department}校友组织`, { department })
  if (department && major) add('major', [department, major], `${department} · ${major}`, { department, major })
  if (enrollmentYear) add('grade', [enrollmentYear], `${enrollmentYear}级校友组织`, { enrollmentYear })
  if (department && major && className && enrollmentYear) add('class', [department, major, enrollmentYear, className], `${enrollmentYear}级 · ${className}`, { department, major, className, enrollmentYear })
  return rows
}
