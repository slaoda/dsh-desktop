import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { exactVersionSchema } from '../shared/contracts'

export interface SwitchTransaction {
  schemaVersion: 1
  previousVersion: string | null
  candidateVersion: string
  startedAt: string
}

export class SwitchTransactionStore {
  readonly file: string

  constructor(userData: string) {
    this.file = path.join(userData, 'dsh-switch-transaction.json')
  }

  async begin(previousVersion: string | null, candidateVersion: string): Promise<SwitchTransaction> {
    const transaction: SwitchTransaction = {
      schemaVersion: 1,
      previousVersion: previousVersion === null ? null : exactVersionSchema.parse(previousVersion),
      candidateVersion: exactVersionSchema.parse(candidateVersion),
      startedAt: new Date().toISOString()
    }
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 })
    return transaction
  }

  async read(): Promise<SwitchTransaction | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SwitchTransaction>
      if (value.schemaVersion !== 1 || typeof value.startedAt !== 'string') throw new Error('版本切换事务记录无效')
      return {
        schemaVersion: 1,
        previousVersion: value.previousVersion === null ? null : exactVersionSchema.parse(value.previousVersion),
        candidateVersion: exactVersionSchema.parse(value.candidateVersion),
        startedAt: value.startedAt
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async complete(): Promise<void> {
    await rm(this.file, { force: true })
  }
}

