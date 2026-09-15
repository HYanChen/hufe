import fs from 'node:fs/promises'
import path from 'node:path'

const initialData = () => ({
  version: 1,
  accounts: [],
  adminDelegations: [],
  identityConflicts: [],
  manualIdentityVerifications: [],
  manualVerificationMediaOrphans: [],
  auditLogs: [],
  contentRules: []
})

export class JsonDatabase {
  constructor(file) {
    this.file = file
    this.data = initialData()
    this.queue = Promise.resolve()
  }

  async init() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.data = { ...initialData(), ...parsed }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await this.persist()
    }
    return this
  }

  read(selector = (value) => value) {
    return selector(structuredClone(this.data))
  }

  async transaction(mutator) {
    const run = async () => {
      const draft = structuredClone(this.data)
      const result = await mutator(draft)
      // Only publish a transaction after its atomic disk replacement succeeds.
      await this.persist(draft)
      this.data = draft
      return result
    }
    const task = this.queue.then(run, run)
    this.queue = task.catch(() => {})
    return task
  }

  async persist(data = this.data) {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, this.file)
  }
}
