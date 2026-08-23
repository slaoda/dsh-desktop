import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, statfs } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { BackupReason, BackupScope, BackupSummary } from '../shared/contracts'

interface BackupFile {
  path: string
  bytes: number
  sha256: string
}

interface BackupManifest extends BackupSummary {
  schemaVersion: 1
  files: BackupFile[]
}

// Official source contracts for the Harness home, settings, credentials, and sessions:
// https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md
// https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/credentials/credentials-local/README.md
// https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md
const configurationRoots = [
  'settings.yaml', 'settings.yml', 'settings.json', 'cordis.patch.yml', 'cordis.patch.yaml',
  'AGENTS.md', 'profiles', 'skills', '.agent-presets'
] as const
const sessionRoot = 'sessions'
const backupIdPattern = /^\d{8}T\d{9}Z-[0-9a-f]{8}$/
const excludedNames = new Set(['.credentials.yaml', '.credentials.yml', '.env', '.key'])

function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return excludedNames.has(lower) || lower.startsWith('.env.') || lower === '.envrc' || lower.includes('credential') || /\.(?:key|pem|p12|pfx)$/i.test(lower)
}

function portablePath(relative: string): string {
  return relative.split(path.sep).join('/')
}

function safeManifestPath(value: string): string {
  if (!value || value.includes('\\') || path.posix.isAbsolute(value)) throw new Error('备份清单包含不安全路径')
  const normalized = path.posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../') || normalized !== value) throw new Error('备份清单包含不安全路径')
  if (normalized.split('/').some(isSensitiveName)) throw new Error('备份清单包含敏感文件')
  return normalized
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

export class BackupManager {
  readonly backupsDir: string
  readonly harnessHome: string

  constructor(userData: string, harnessHome: string, private readonly retention = 3) {
    this.backupsDir = path.join(userData, 'harness-backups')
    this.harnessHome = path.resolve(harnessHome)
    if (!path.isAbsolute(this.harnessHome)) throw new Error('Harness 主目录必须是绝对路径')
    if (!Number.isInteger(retention) || retention < 1 || retention > 100) throw new Error('备份保留数量无效')
  }

  async create(reason: BackupReason, scope: BackupScope): Promise<BackupSummary> {
    if (!['manual', 'update', 'pre-restore', 'pre-repair'].includes(reason)) throw new Error('备份原因无效')
    if (!['configuration', 'full'].includes(scope)) throw new Error('备份范围无效')
    const home = await lstat(this.harnessHome)
    if (!home.isDirectory() || home.isSymbolicLink()) throw new Error('Harness 主目录无效或为符号链接')
    await mkdir(this.backupsDir, { recursive: true })
    const estimatedBytes = await this.estimate(scope)
    const disk = await statfs(this.backupsDir)
    const availableBytes = disk.bavail * disk.bsize
    if (availableBytes < estimatedBytes + 1_048_576) throw new Error('磁盘可用空间不足，无法创建 Harness 备份')

    const createdAt = new Date().toISOString()
    const id = `${createdAt.replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`
    const staging = path.join(this.backupsDir, `.backup-${id}`)
    const destination = path.join(this.backupsDir, id)
    const dataRoot = path.join(staging, 'data')
    const files: BackupFile[] = []
    try {
      await mkdir(dataRoot, { recursive: true })
      for (const root of this.roots(scope)) await this.copyAllowedRoot(root, dataRoot, files)
      const manifest: BackupManifest = {
        schemaVersion: 1,
        id,
        createdAt,
        reason,
        scope,
        fileCount: files.length,
        bytes: files.reduce((total, item) => total + item.bytes, 0),
        files
      }
      await writeFileAtomic(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      await rename(staging, destination)
      await this.prune()
      return this.summary(manifest)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async hasSource(): Promise<boolean> {
    try {
      const info = await lstat(this.harnessHome)
      return info.isDirectory() && !info.isSymbolicLink()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async list(): Promise<BackupSummary[]> {
    let names: string[] = []
    try { names = await readdir(this.backupsDir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const summaries: BackupSummary[] = []
    for (const name of names) {
      if (!backupIdPattern.test(name)) continue
      try { summaries.push(this.summary(await this.readManifest(name))) } catch { /* Ignore incomplete/corrupt entries in inventory. */ }
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  }

  async restore(id: string, scope: BackupScope): Promise<void> {
    if (!backupIdPattern.test(id)) throw new Error('备份标识无效')
    if (!['configuration', 'full'].includes(scope)) throw new Error('恢复范围无效')
    const manifest = await this.readManifest(id)
    const selected = manifest.files.filter((item) => scope === 'full' || !item.path.startsWith(`${sessionRoot}/`))
    const dataRoot = path.join(this.backupsDir, id, 'data')

    for (const item of selected) {
      const relative = safeManifestPath(item.path)
      const source = path.join(dataRoot, ...relative.split('/'))
      const sourceStat = await lstat(source)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`备份文件类型无效：${relative}`)
      if (sourceStat.size !== item.bytes || await sha256(source) !== item.sha256) throw new Error(`备份完整性校验失败：${relative}`)
    }
    for (const item of selected) {
      const relative = safeManifestPath(item.path)
      await this.assertSafeRestoreTarget(relative)
      const source = path.join(dataRoot, ...relative.split('/'))
      const target = path.join(this.harnessHome, ...relative.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(source, target)
    }
  }

  private roots(scope: BackupScope): readonly string[] {
    return scope === 'full' ? [...configurationRoots, sessionRoot] : configurationRoots
  }

  private async estimate(scope: BackupScope): Promise<number> {
    let bytes = 0
    const visit = async (target: string): Promise<void> => {
      let info
      try { info = await lstat(target) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      if (info.isSymbolicLink() || isSensitiveName(path.basename(target))) return
      if (info.isFile()) { bytes += info.size; return }
      if (!info.isDirectory()) return
      for (const child of await readdir(target)) await visit(path.join(target, child))
    }
    for (const root of this.roots(scope)) await visit(path.join(this.harnessHome, root))
    return bytes
  }

  private async copyAllowedRoot(root: string, dataRoot: string, files: BackupFile[]): Promise<void> {
    const visit = async (source: string, relative: string): Promise<void> => {
      let info
      try { info = await lstat(source) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      if (info.isSymbolicLink() || isSensitiveName(path.basename(source))) return
      if (info.isDirectory()) {
        for (const child of await readdir(source)) await visit(path.join(source, child), path.join(relative, child))
        return
      }
      if (!info.isFile()) return
      const destination = path.join(dataRoot, relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(source, destination)
      files.push({ path: portablePath(relative), bytes: info.size, sha256: await sha256(destination) })
    }
    await visit(path.join(this.harnessHome, root), root)
  }

  private async readManifest(id: string): Promise<BackupManifest> {
    if (!backupIdPattern.test(id)) throw new Error('备份标识无效')
    const parsed = JSON.parse(await readFile(path.join(this.backupsDir, id, 'manifest.json'), 'utf8')) as Partial<BackupManifest>
    if (parsed.schemaVersion !== 1 || parsed.id !== id || typeof parsed.createdAt !== 'string') throw new Error('备份清单无效')
    if (!['manual', 'update', 'pre-restore', 'pre-repair'].includes(parsed.reason ?? '')) throw new Error('备份清单无效')
    if (!['configuration', 'full'].includes(parsed.scope ?? '')) throw new Error('备份清单无效')
    if (!Array.isArray(parsed.files)) throw new Error('备份清单无效')
    const files = parsed.files.map((item) => {
      if (!item || typeof item.path !== 'string' || !Number.isSafeInteger(item.bytes) || (item.bytes ?? -1) < 0 || !/^[0-9a-f]{64}$/.test(item.sha256 ?? '')) throw new Error('备份清单无效')
      return { path: safeManifestPath(item.path), bytes: item.bytes, sha256: item.sha256 }
    })
    return {
      schemaVersion: 1, id, createdAt: parsed.createdAt,
      reason: parsed.reason as BackupReason, scope: parsed.scope as BackupScope,
      fileCount: files.length, bytes: files.reduce((total, item) => total + item.bytes, 0), files
    }
  }

  private summary(manifest: BackupManifest): BackupSummary {
    const { id, createdAt, reason, scope, fileCount, bytes } = manifest
    return { id, createdAt, reason, scope, fileCount, bytes }
  }

  private async prune(): Promise<void> {
    const backups = await this.list()
    for (const backup of backups.slice(this.retention)) {
      const target = path.join(this.backupsDir, backup.id)
      if (path.dirname(target) !== this.backupsDir) throw new Error('拒绝清理不安全的备份路径')
      await rm(target, { recursive: true, force: true })
    }
  }

  private async assertSafeRestoreTarget(relative: string): Promise<void> {
    try {
      const home = await lstat(this.harnessHome)
      if (home.isSymbolicLink() || !home.isDirectory()) throw new Error('拒绝恢复到无效的 Harness 主目录')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    let current = this.harnessHome
    for (const segment of relative.split('/')) {
      current = path.join(current, segment)
      try {
        const info = await lstat(current)
        if (info.isSymbolicLink()) throw new Error(`拒绝恢复到符号链接路径：${relative}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return
      }
    }
  }
}
