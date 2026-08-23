import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { exactVersionSchema, externalInstallationIdSchema } from '../shared/contracts'

export interface SwitchTransaction {
  schemaVersion: 2
  previousVersion: string | null
  previousExternalId: string | null
  candidateVersion: string
  candidateExternalId: string | null
  startedAt: string
}

export class SwitchTransactionStore {
  readonly file: string

  constructor(userData: string) {
    this.file = path.join(userData, 'dsh-switch-transaction.json')
  }

  async begin(
    previousVersion: string | null,
    candidateVersion: string,
    previousExternalId: string | null = null,
    candidateExternalId: string | null = null
  ): Promise<SwitchTransaction> {
    const transaction: SwitchTransaction = {
      schemaVersion: 2,
      previousVersion: previousVersion === null ? null : exactVersionSchema.parse(previousVersion),
      previousExternalId: previousExternalId === null ? null : externalInstallationIdSchema.parse(previousExternalId),
      candidateVersion: exactVersionSchema.parse(candidateVersion),
      candidateExternalId: candidateExternalId === null ? null : externalInstallationIdSchema.parse(candidateExternalId),
      startedAt: new Date().toISOString()
    }
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 })
    return transaction
  }

  async read(): Promise<SwitchTransaction | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SwitchTransaction> & { schemaVersion?: number }
      if (![1, 2].includes(value.schemaVersion ?? 0) || typeof value.startedAt !== 'string') throw new Error('版本切换事务记录无效')
      return {
        schemaVersion: 2,
        previousVersion: value.previousVersion === null ? null : exactVersionSchema.parse(value.previousVersion),
        previousExternalId: value.schemaVersion === 2 && value.previousExternalId != null ? externalInstallationIdSchema.parse(value.previousExternalId) : null,
        candidateVersion: exactVersionSchema.parse(value.candidateVersion),
        candidateExternalId: value.schemaVersion === 2 && value.candidateExternalId != null ? externalInstallationIdSchema.parse(value.candidateExternalId) : null,
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
