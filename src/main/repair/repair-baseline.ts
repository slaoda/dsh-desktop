import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { exactVersionSchema, pluginEntryIdSchema, pluginPackageNameSchema } from '../../shared/contracts'

const maxFingerprintBytes = 2_097_152
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const pluginEntrySchema = z.object({
  entryId: pluginEntryIdSchema,
  packageName: pluginPackageNameSchema
}).strict()
const fileFingerprintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('missing') }).strict(),
  z.object({ kind: z.literal('unsafe') }).strict(),
  z.object({ kind: z.literal('oversized') }).strict(),
  z.object({
    kind: z.literal('file'),
    bytes: z.number().int().nonnegative().max(maxFingerprintBytes),
    modifiedAt: z.string().datetime(),
    sha256: sha256Schema
  }).strict()
])
const repairBaselineSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  version: exactVersionSchema,
  source: z.enum(['bundled', 'installed']),
  effectiveConfigSha256: sha256Schema,
  profile: z.object({
    dependencies: z.record(pluginPackageNameSchema, z.string().min(1).max(200)),
    bundles: z.array(pluginPackageNameSchema).max(200),
    entries: z.array(pluginEntrySchema).max(1_000)
  }).strict(),
  files: z.object({
    profilePackage: fileFingerprintSchema,
    profilePatch: fileFingerprintSchema,
    homePatch: fileFingerprintSchema
  }).strict()
}).strict()

export type RepairBaseline = z.infer<typeof repairBaselineSchema>
export type PluginBaselineEntry = z.infer<typeof pluginEntrySchema>

export interface CaptureRepairBaselineInput {
  version: string
  source: 'bundled' | 'installed' | 'external'
  effectiveConfig: string
  entries: PluginBaselineEntry[]
}

interface ProfileInventory {
  dependencies: Record<string, string>
  bundles: string[]
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

async function fingerprint(file: string): Promise<z.infer<typeof fileFingerprintSchema>> {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) return { kind: 'unsafe' }
    if (info.size > maxFingerprintBytes) return { kind: 'oversized' }
    return { kind: 'file', bytes: info.size, modifiedAt: info.mtime.toISOString(), sha256: await sha256File(file) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unsafe' }
  }
}

function safeEntries(entries: PluginBaselineEntry[]): PluginBaselineEntry[] {
  const unique = new Map<string, PluginBaselineEntry>()
  for (const item of entries) {
    const parsed = pluginEntrySchema.safeParse(item)
    if (parsed.success) unique.set(`${parsed.data.entryId}\0${parsed.data.packageName}`, parsed.data)
  }
  return [...unique.values()].sort((a, b) => a.entryId.localeCompare(b.entryId) || a.packageName.localeCompare(b.packageName))
}

async function readProfileInventory(packageFile: string): Promise<ProfileInventory> {
  try {
    const info = await lstat(packageFile)
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxFingerprintBytes) return { dependencies: {}, bundles: [] }
    const parsed = JSON.parse(await readFile(packageFile, 'utf8')) as Record<string, unknown>
    const rawDependencies = parsed.dependencies && typeof parsed.dependencies === 'object'
      ? parsed.dependencies as Record<string, unknown>
      : {}
    const dependencies: Record<string, string> = {}
    for (const [name, version] of Object.entries(rawDependencies)) {
      if (pluginPackageNameSchema.safeParse(name).success && typeof version === 'string' && version.length >= 1 && version.length <= 200) {
        dependencies[name] = version
      }
    }
    const dsh = parsed.dsh && typeof parsed.dsh === 'object' ? parsed.dsh as Record<string, unknown> : {}
    const profile = dsh.profile && typeof dsh.profile === 'object' ? dsh.profile as Record<string, unknown> : {}
    const bundles = Array.isArray(profile.bundles)
      ? profile.bundles.filter((item): item is string => pluginPackageNameSchema.safeParse(item).success).slice(0, 200)
      : []
    return { dependencies, bundles }
  } catch {
    return { dependencies: {}, bundles: [] }
  }
}

export class RepairBaselineStore {
  readonly file: string
  private readonly harnessHome: string
  private readonly profileRoot: string

  constructor(userData: string, harnessHome: string) {
    this.file = path.join(path.resolve(userData), 'repair', 'last-known-good.json')
    this.harnessHome = path.resolve(harnessHome)
    this.profileRoot = path.join(this.harnessHome, 'profiles', 'web')
  }

  async capture(input: CaptureRepairBaselineInput): Promise<RepairBaseline> {
    const baseline = await this.snapshot(input)
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 })
    return baseline
  }

  async snapshot(input: CaptureRepairBaselineInput): Promise<RepairBaseline> {
    if (input.source === 'external') throw new Error('外部 Harness 不能写入托管启动基线')
    const version = exactVersionSchema.parse(input.version)
    const packageFile = path.join(this.profileRoot, 'package.json')
    const profilePatch = path.join(this.profileRoot, 'cordis.patch.yml')
    const homePatch = path.join(this.harnessHome, 'cordis.patch.yml')
    const [profile, profilePackageFingerprint, profilePatchFingerprint, homePatchFingerprint] = await Promise.all([
      readProfileInventory(packageFile), fingerprint(packageFile), fingerprint(profilePatch), fingerprint(homePatch)
    ])
    return repairBaselineSchema.parse({
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      version,
      source: input.source,
      effectiveConfigSha256: sha256Text(input.effectiveConfig),
      profile: { ...profile, entries: safeEntries(input.entries) },
      files: {
        profilePackage: profilePackageFingerprint,
        profilePatch: profilePatchFingerprint,
        homePatch: homePatchFingerprint
      }
    })
  }

  async read(): Promise<RepairBaseline | null> {
    try {
      return repairBaselineSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      return null
    }
  }
}

export function findUniquePluginChange(previous: RepairBaseline, current: RepairBaseline): PluginBaselineEntry | null {
  if (previous.version !== current.version || previous.source !== current.source) return null
  if (JSON.stringify(previous.files.profilePatch) !== JSON.stringify(current.files.profilePatch)) return null
  if (JSON.stringify(previous.files.homePatch) !== JSON.stringify(current.files.homePatch)) return null
  const previousEntries = new Map(previous.profile.entries.map((item) => [item.entryId, item.packageName]))
  const changedPackages = new Set(Object.entries(current.profile.dependencies)
    .filter(([name, version]) => previous.profile.dependencies[name] !== version)
    .map(([name]) => name))
  const candidates = new Map<string, PluginBaselineEntry>()
  for (const entry of current.profile.entries) {
    if (previousEntries.get(entry.entryId) !== entry.packageName || changedPackages.has(entry.packageName)) {
      candidates.set(`${entry.entryId}\0${entry.packageName}`, entry)
    }
  }
  if (candidates.size !== 1) return null
  const candidate = [...candidates.values()][0]
  const remainingDependencies = (dependencies: Record<string, string>): Array<[string, string]> => Object.entries(dependencies)
    .filter(([name]) => name !== candidate.packageName)
    .sort(([left], [right]) => left.localeCompare(right))
  const remainingEntries = (entries: PluginBaselineEntry[]): PluginBaselineEntry[] => entries
    .filter((entry) => entry.entryId !== candidate.entryId)
    .sort((left, right) => left.entryId.localeCompare(right.entryId) || left.packageName.localeCompare(right.packageName))
  const remainingBundles = (bundles: string[]): string[] => bundles.filter((name) => name !== candidate.packageName)
  if (JSON.stringify(remainingDependencies(previous.profile.dependencies)) !== JSON.stringify(remainingDependencies(current.profile.dependencies))) return null
  if (JSON.stringify(remainingEntries(previous.profile.entries)) !== JSON.stringify(remainingEntries(current.profile.entries))) return null
  if (JSON.stringify(remainingBundles(previous.profile.bundles)) !== JSON.stringify(remainingBundles(current.profile.bundles))) return null
  return candidate
}
