import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { defaultRegistryUrl, exactVersionSchema, officialPackageName, registryUrlSchema, type InstallProgress, type InstalledVersion } from '../shared/contracts'
import type { RuntimePaths } from './runtime-paths'
import { npmProxyEnvironment } from './network-proxy'
import { prependRuntimePath } from './runtime-path-environment'

interface PackageManifest {
  name?: string
  version?: string
  bin?: string | Record<string, string>
}

const pnpmBuildPolicy = `allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': false
  koffi: false
  node-pty: false
  protobufjs: false
`

function summarizePnpmFailure(output: string): string {
  const lines = output
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Progress:') && !/^\++$/.test(line))
  return lines.slice(-8).join(' | ').slice(-1_500)
}

export interface ResolvedDsh {
  version: string
  root: string
  entry: string
  source: 'bundled' | 'installed' | 'external'
}

const repairDirectoryNameSchema = z.string().regex(/^\.repair-(?:install|backup)-[0-9A-Za-z.+-]+-[0-9a-f-]{36}$/)
const versionRepairRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  version: exactVersionSchema,
  stagingName: repairDirectoryNameSchema,
  rollbackName: repairDirectoryNameSchema.nullable(),
  stage: z.enum(['prepared', 'swapped', 'committed']),
  startedAt: z.string().datetime()
}).strict()

export type VersionRepairRecord = z.infer<typeof versionRepairRecordSchema>

export interface ManagedVersionRepairTransaction {
  candidate: ResolvedDsh
  commit(): Promise<void>
  rollback(): Promise<void>
}

export class VersionManager {
  readonly versionsDir: string
  readonly installFailureLog: string
  readonly repairTransactionFile: string

  constructor(
    userData: string,
    private readonly bundledDir: string,
    private readonly runtime: RuntimePaths,
    private proxyUrl: string | null = null,
    private readonly installStallTimeoutMs = 5 * 60_000
  ) {
    this.versionsDir = path.join(userData, 'dsh-versions')
    this.installFailureLog = path.join(userData, 'dsh-install-failure.log')
    this.repairTransactionFile = path.join(this.versionsDir, '.repair-transaction.json')
  }

  setProxyUrl(proxyUrl: string | null): void {
    this.proxyUrl = proxyUrl
  }

  async cleanupInterruptedInstalls(): Promise<void> {
    await this.recoverInterruptedRepair()
    let names: string[] = []
    try { names = await readdir(this.versionsDir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await Promise.all(names
      .filter((name) => name.startsWith('.install-') || name.startsWith('.repair-install-'))
      .map(async (name) => { await rm(path.join(this.versionsDir, name), { recursive: true, force: true }) }))
  }

  async list(): Promise<InstalledVersion[]> {
    const entries: InstalledVersion[] = []
    for (const [base, source] of [[this.versionsDir, 'installed'], [this.bundledDir, 'bundled']] as const) {
      let names: string[] = []
      try { names = await readdir(base) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      for (const version of names) {
        if (!exactVersionSchema.safeParse(version).success) continue
        try {
          await this.resolveAt(path.join(base, version), version, source)
          entries.push({ version, source })
        } catch {
          // Keep an installed exact-version directory visible so the startup
          // repair path can replace a damaged manifest or CLI transactionally.
          if (source === 'installed') entries.push({ version, source })
        }
      }
    }
    return entries.filter((item, index, all) => all.findIndex((other) => other.version === item.version) === index)
  }

  async resolve(version: string): Promise<ResolvedDsh> {
    exactVersionSchema.parse(version)
    const installed = path.join(this.versionsDir, version)
    if (existsSync(installed)) return await this.resolveAt(installed, version, 'installed')
    return await this.resolveAt(path.join(this.bundledDir, version), version, 'bundled')
  }

  async install(version: string, availableVersions: string[], progress: (value: InstallProgress) => void, registryUrl: string = defaultRegistryUrl): Promise<void> {
    exactVersionSchema.parse(version)
    const validatedRegistryUrl = registryUrlSchema.parse(registryUrl)
    if (!availableVersions.includes(version)) throw new Error('该版本不在官方 npm 版本目录中')
    await mkdir(this.versionsDir, { recursive: true })
    const destination = path.join(this.versionsDir, version)
    if (existsSync(destination)) {
      await this.resolveAt(destination, version, 'installed')
      return
    }
    const staging = path.join(this.versionsDir, `.install-${version}-${Date.now()}`)
    await mkdir(staging, { recursive: true })
    try {
      await this.prepareInstallDirectory(staging, version, progress, validatedRegistryUrl)
      await rename(staging, destination)
      progress({ version, phase: 'complete', message: `DSH ${version} 已安装` })
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      progress({ version, phase: 'failed', message: error instanceof Error ? error.message : '安装失败' })
      throw error
    }
  }

  async uninstall(version: string): Promise<void> {
    exactVersionSchema.parse(version)
    const destination = path.join(this.versionsDir, version)
    if (!existsSync(destination)) throw new Error('该版本不是用户安装的 DSH 版本')
    await this.resolveAt(destination, version, 'installed')
    await rm(destination, { recursive: true, force: true })
  }

  async beginRepair(
    version: string,
    progress: (value: InstallProgress) => void,
    registryUrl: string = defaultRegistryUrl
  ): Promise<ManagedVersionRepairTransaction> {
    const validatedVersion = exactVersionSchema.parse(version)
    const validatedRegistryUrl = registryUrlSchema.parse(registryUrl)
    await mkdir(this.versionsDir, { recursive: true })
    await this.recoverInterruptedRepair()
    const id = randomUUID()
    const stagingName = `.repair-install-${validatedVersion}-${id}`
    const destination = path.join(this.versionsDir, validatedVersion)
    const rollbackName = existsSync(destination) ? `.repair-backup-${validatedVersion}-${id}` : null
    const staging = this.repairPath(stagingName)
    await mkdir(staging, { recursive: true })
    let record: VersionRepairRecord | null = null
    try {
      await this.prepareInstallDirectory(staging, validatedVersion, progress, validatedRegistryUrl)
      record = versionRepairRecordSchema.parse({
        schemaVersion: 1, id, version: validatedVersion, stagingName, rollbackName,
        stage: 'prepared', startedAt: new Date().toISOString()
      })
      await this.writeRepairTransaction(record)
      if (rollbackName) await rename(destination, this.repairPath(rollbackName))
      await rename(staging, destination)
      record = { ...record, stage: 'swapped' }
      await this.writeRepairTransaction(record)
      const candidate = await this.resolveAt(destination, validatedVersion, 'installed')
      let finished = false
      return {
        candidate,
        commit: async () => {
          if (finished) return
          await this.finishRepair(record as VersionRepairRecord, true)
          finished = true
        },
        rollback: async () => {
          if (finished) return
          await this.finishRepair(record as VersionRepairRecord, false)
          finished = true
        }
      }
    } catch (error) {
      if (record) await this.rollbackRepair(record)
      else await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async readRepairTransaction(): Promise<VersionRepairRecord | null> {
    try {
      return versionRepairRecordSchema.parse(JSON.parse(await readFile(this.repairTransactionFile, 'utf8')))
    } catch {
      return null
    }
  }

  private async runPnpmInstall(prefix: string, version: string, progress: (value: InstallProgress) => void, registryUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.runtime.node, [
        this.runtime.pnpmCli,
        'install',
        '--dir', prefix,
        '--prefer-offline',
        `--registry=${registryUrl}`,
        '--reporter=append-only'
      ], {
        env: {
          ...prependRuntimePath(npmProxyEnvironment(this.proxyUrl), [path.dirname(this.runtime.node), this.runtime.commandDir]),
          CI: '1',
          pnpm_config_minimum_release_age: '0',
          // Only the official helper permission fix is allowlisted in pnpm-workspace.yaml.
          // Future unapproved native builds stay blocked without making installation fatal.
          pnpm_config_strict_dep_builds: 'false'
        },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let settled = false
      let output = ''
      let lineBuffer = ''
      let lastProgress = ''
      let stallTimer: NodeJS.Timeout
      let terminationError: Error | null = null
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(stallTimer)
        if (error) reject(error)
        else resolve()
      }
      const resetStallTimer = (): void => {
        if (terminationError) return
        clearTimeout(stallTimer)
        stallTimer = setTimeout(() => {
          terminationError = new Error(`pnpm 安装超过 ${Math.round(this.installStallTimeoutMs / 60_000)} 分钟无进展`)
          child.kill()
        }, this.installStallTimeoutMs)
      }
      const consume = (chunk: string): void => {
        resetStallTimer()
        output = `${output}${chunk}`.slice(-512 * 1_024)
        lineBuffer += chunk
        const lines = lineBuffer.split(/\r?\n/)
        lineBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const match = line.match(/Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/)
          if (!match) continue
          const signature = match.slice(1).join(':')
          if (signature === lastProgress) continue
          lastProgress = signature
          progress({
            version,
            phase: 'downloading',
            message: `正在获取依赖：已解析 ${match[1]}，已复用 ${match[2]}，已下载 ${match[3]}，已安装 ${match[4]}`
          })
        }
      }
      child.stdout.setEncoding('utf8').on('data', consume)
      child.stderr.setEncoding('utf8').on('data', consume)
      child.once('error', (error) => finish(error))
      child.once('exit', (code) => {
        if (terminationError) {
          finish(terminationError)
          return
        }
        if (code === 0) {
          finish()
          return
        }
        const detail = summarizePnpmFailure(output)
        const error = new Error(`pnpm 安装失败（退出码 ${code ?? 'unknown'}）：${detail || '未返回错误详情'}`)
        const log = [`DSH ${version}`, new Date().toISOString(), '', output].join('\n')
        void writeFile(this.installFailureLog, log).then(() => finish(error), () => finish(error))
      })
      resetStallTimer()
    })
  }

  private async prepareInstallDirectory(
    staging: string,
    version: string,
    progress: (value: InstallProgress) => void,
    registryUrl: string
  ): Promise<void> {
    await Promise.all([
      writeFile(path.join(staging, 'package.json'), `${JSON.stringify({
        name: 'dsh-desktop-managed-version', version: '0.0.0', private: true,
        dependencies: { [officialPackageName]: version }
      })}\n`),
      writeFile(path.join(staging, 'pnpm-workspace.yaml'), pnpmBuildPolicy)
    ])
    progress({ version, phase: 'downloading', message: `正在安装官方 DSH ${version}` })
    await this.runPnpmInstall(staging, version, progress, registryUrl)
    progress({ version, phase: 'validating', message: '正在校验官方包版本和入口' })
    await this.resolveAt(staging, version, 'installed')
  }

  private repairPath(name: string): string {
    const validated = repairDirectoryNameSchema.parse(name)
    const target = path.join(this.versionsDir, validated)
    if (path.dirname(target) !== this.versionsDir) throw new Error('版本修复事务路径无效')
    return target
  }

  private async writeRepairTransaction(record: VersionRepairRecord): Promise<void> {
    await writeFileAtomic(this.repairTransactionFile, `${JSON.stringify(versionRepairRecordSchema.parse(record), null, 2)}\n`, { mode: 0o600 })
  }

  private async finishRepair(record: VersionRepairRecord, commit: boolean): Promise<void> {
    const current = await this.readRepairTransaction()
    if (!current || current.id !== record.id) throw new Error('版本修复事务不存在或已被替换')
    if (commit) {
      const committed = versionRepairRecordSchema.parse({ ...current, stage: 'committed' })
      await this.writeRepairTransaction(committed)
      if (committed.rollbackName) await rm(this.repairPath(committed.rollbackName), { recursive: true, force: true })
      await rm(this.repairPath(committed.stagingName), { recursive: true, force: true })
      await rm(this.repairTransactionFile, { force: true })
      return
    }
    await this.rollbackRepair(current)
  }

  private async recoverInterruptedRepair(): Promise<boolean> {
    const record = await this.readRepairTransaction()
    if (!record) return false
    if (record.stage === 'committed') {
      if (record.rollbackName) await rm(this.repairPath(record.rollbackName), { recursive: true, force: true })
      await rm(this.repairPath(record.stagingName), { recursive: true, force: true })
      await rm(this.repairTransactionFile, { force: true })
      return true
    }
    await this.rollbackRepair(record)
    return true
  }

  private async rollbackRepair(record: VersionRepairRecord): Promise<void> {
    const destination = path.join(this.versionsDir, exactVersionSchema.parse(record.version))
    const rollback = record.rollbackName ? this.repairPath(record.rollbackName) : null
    if (rollback && existsSync(rollback)) {
      await rm(destination, { recursive: true, force: true })
      await rename(rollback, destination)
    } else if (!rollback) {
      await rm(destination, { recursive: true, force: true })
    }
    await rm(this.repairPath(record.stagingName), { recursive: true, force: true })
    await rm(this.repairTransactionFile, { force: true })
  }

  private async resolveAt(root: string, version: string, source: ResolvedDsh['source']): Promise<ResolvedDsh> {
    const packageRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as PackageManifest
    if (manifest.name !== officialPackageName || manifest.version !== version) throw new Error('官方 DSH 包身份或版本校验失败')
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
    if (!bin) throw new Error('官方 DSH 包未提供 dsh CLI 入口')
    const entry = path.resolve(packageRoot, bin)
    if (!entry.startsWith(`${packageRoot}${path.sep}`) || !existsSync(entry)) throw new Error('官方 DSH CLI 入口无效')
    return { version, root, entry, source }
  }
}
