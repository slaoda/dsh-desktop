import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { pluginEntryIdSchema, pluginPackageNameSchema } from '../../shared/contracts'

const quarantineRecordSchema = z.object({
  entryId: pluginEntryIdSchema,
  packageName: pluginPackageNameSchema.nullable(),
  disposition: z.enum(['pending', 'kept']),
  createdAt: z.string().datetime()
}).strict()
const quarantineStateSchema = z.object({
  schemaVersion: z.literal(1),
  records: z.array(quarantineRecordSchema).max(100)
}).strict()

export type QuarantineRecord = z.infer<typeof quarantineRecordSchema>

function overlayContent(records: QuarantineRecord[]): string {
  return `${JSON.stringify(records.map((record) => ({ id: record.entryId, disabled: true })), null, 2)}\n`
}

export class PluginQuarantineStore {
  readonly stateFile: string
  readonly overlayFile: string
  private readonly directory: string

  constructor(userData: string) {
    this.directory = path.join(path.resolve(userData), 'repair')
    this.stateFile = path.join(this.directory, 'plugin-quarantine.json')
    this.overlayFile = path.join(this.directory, 'plugin-quarantine.patch.json')
  }

  async activate(candidate: { entryId: string; packageName: string | null }): Promise<QuarantineRecord> {
    const entryId = pluginEntryIdSchema.parse(candidate.entryId)
    const packageName = candidate.packageName === null ? null : pluginPackageNameSchema.parse(candidate.packageName)
    const record = quarantineRecordSchema.parse({
      entryId, packageName, disposition: 'pending', createdAt: new Date().toISOString()
    })
    const records = (await this.list()).filter((item) => item.entryId !== entryId)
    records.push(record)
    await this.write(records)
    return record
  }

  async keep(entryId: string): Promise<QuarantineRecord> {
    const validatedId = pluginEntryIdSchema.parse(entryId)
    const records = await this.list()
    const index = records.findIndex((item) => item.entryId === validatedId)
    if (index < 0) throw new Error('插件隔离记录不存在')
    records[index] = { ...records[index], disposition: 'kept' }
    await this.write(records)
    return records[index]
  }

  async find(entryId: string): Promise<QuarantineRecord | null> {
    const validatedId = pluginEntryIdSchema.parse(entryId)
    return (await this.list()).find((item) => item.entryId === validatedId) ?? null
  }

  async restore(record: QuarantineRecord): Promise<void> {
    const validated = quarantineRecordSchema.parse(record)
    const records = (await this.list()).filter((item) => item.entryId !== validated.entryId)
    records.push(validated)
    await this.write(records)
  }

  async remove(entryId: string): Promise<void> {
    const validatedId = pluginEntryIdSchema.parse(entryId)
    await this.write((await this.list()).filter((item) => item.entryId !== validatedId))
  }

  async list(): Promise<QuarantineRecord[]> {
    try {
      const parsed = quarantineStateSchema.parse(JSON.parse(await readFile(this.stateFile, 'utf8')))
      return [...parsed.records].sort((a, b) => a.entryId.localeCompare(b.entryId))
    } catch {
      return []
    }
  }

  async overlayPath(): Promise<string | null> {
    const records = await this.list()
    if (records.length === 0) return null
    try {
      return await readFile(this.overlayFile, 'utf8') === overlayContent(records) ? this.overlayFile : null
    } catch {
      return null
    }
  }

  private async write(records: QuarantineRecord[]): Promise<void> {
    const state = quarantineStateSchema.parse({
      schemaVersion: 1,
      records: [...records].sort((a, b) => a.entryId.localeCompare(b.entryId))
    })
    if (state.records.length === 0) {
      await rm(this.stateFile, { force: true })
      await rm(this.overlayFile, { force: true })
      return
    }
    await mkdir(this.directory, { recursive: true })
    await writeFileAtomic(this.overlayFile, overlayContent(state.records), { mode: 0o600 })
    await writeFileAtomic(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  }
}
