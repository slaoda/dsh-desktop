import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { pluginEntryIdSchema, pluginPackageNameSchema } from '../../shared/contracts'
import { PluginQuarantineStore, type QuarantineRecord } from './plugin-quarantine'

const previousRecordSchema = z.object({
  entryId: pluginEntryIdSchema,
  packageName: pluginPackageNameSchema.nullable(),
  disposition: z.enum(['pending', 'kept']),
  createdAt: z.string().datetime()
}).strict()
const repairTransactionSchema = z.object({
  schemaVersion: z.literal(1),
  repairId: z.string().uuid(),
  stage: z.enum(['prepared', 'applied', 'retrying']),
  action: z.object({
    kind: z.literal('quarantine-plugin'),
    entryId: pluginEntryIdSchema,
    packageName: pluginPackageNameSchema.nullable(),
    previous: previousRecordSchema.nullable()
  }).strict(),
  startedAt: z.string().datetime()
}).strict()

export type RepairTransaction = z.infer<typeof repairTransactionSchema>
export type RepairTransactionStage = RepairTransaction['stage']

export class RepairTransactionStore {
  readonly file: string

  constructor(userData: string) {
    this.file = path.join(path.resolve(userData), 'repair', 'transaction.json')
  }

  async beginPluginQuarantine(input: {
    repairId: string
    entryId: string
    packageName: string | null
    previous: QuarantineRecord | null
  }): Promise<RepairTransaction> {
    if (await this.read()) throw new Error('已有启动修复事务尚未完成')
    const transaction = repairTransactionSchema.parse({
      schemaVersion: 1,
      repairId: input.repairId,
      stage: 'prepared',
      action: {
        kind: 'quarantine-plugin',
        entryId: input.entryId,
        packageName: input.packageName,
        previous: input.previous
      },
      startedAt: new Date().toISOString()
    })
    await this.write(transaction)
    return transaction
  }

  async mark(stage: Exclude<RepairTransactionStage, 'prepared'>): Promise<RepairTransaction> {
    const transaction = await this.read()
    if (!transaction) throw new Error('启动修复事务不存在或无效')
    const updated = repairTransactionSchema.parse({ ...transaction, stage })
    await this.write(updated)
    return updated
  }

  async read(): Promise<RepairTransaction | null> {
    try {
      return repairTransactionSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      return null
    }
  }

  async recover(quarantine: PluginQuarantineStore): Promise<boolean> {
    const transaction = await this.read()
    if (!transaction) return false
    if (transaction.action.previous) await quarantine.restore(transaction.action.previous)
    else await quarantine.remove(transaction.action.entryId)
    await this.complete()
    return true
  }

  async complete(): Promise<void> {
    await rm(this.file, { force: true })
  }

  private async write(transaction: RepairTransaction): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 })
  }
}
