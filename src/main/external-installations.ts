import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { exactVersionSchema, officialPackageName, type ExternalInstallation, type ExternalInstallationSource } from '../shared/contracts'
import { runProcess, type ProcessResult } from './process-utils'
import type { RuntimePaths } from './runtime-paths'
import type { ResolvedDsh } from './version-manager'

interface PackageManifest {
  name?: string
  version?: string
  bin?: string | Record<string, string>
}

export interface ExternalCandidate {
  packageRoot: string
  source: ExternalInstallationSource
  npmPrefix?: string
}

type CandidateProvider = () => Promise<ExternalCandidate[]>
type ProcessRunner = (executable: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<ProcessResult>

interface ValidatedInstallation extends ExternalInstallation {
  entry: string
  npmPrefix: string | null
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function installationId(canonicalRoot: string): string {
  return createHash('sha256').update(canonicalRoot.toLowerCase()).digest('hex').slice(0, 16)
}

function rootFromBinDirectory(directory: string): ExternalCandidate | null {
  if (path.basename(directory).toLowerCase() === '.bin' && path.basename(path.dirname(directory)).toLowerCase() === 'node_modules') {
    return { packageRoot: path.join(path.dirname(directory), '@deepseek-ai', 'dsh'), source: 'project' }
  }
  return { packageRoot: path.join(directory, 'node_modules', '@deepseek-ai', 'dsh'), source: 'path' }
}

function packageRootFromHint(hint: string): string {
  let current = path.resolve(hint)
  if (path.extname(current) || path.basename(current) === 'package.json') current = path.dirname(current)
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, 'package.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.resolve(hint)
}

export class ExternalInstallationManager {
  private installations = new Map<string, ValidatedInstallation>()

  constructor(
    private readonly runtime: RuntimePaths,
    private readonly candidateProvider: CandidateProvider = async () => this.defaultCandidates(),
    private readonly processRunner: ProcessRunner = runProcess
  ) {}

  async refresh(): Promise<ExternalInstallation[]> {
    const candidates = await this.candidateProvider()
    const validated = new Map<string, ValidatedInstallation>()
    for (const candidate of candidates) {
      try {
        const item = await this.validate(candidate)
        const existing = validated.get(item.id)
        if (!existing || this.priority(item.source) > this.priority(existing.source)) validated.set(item.id, item)
      } catch { /* Unverified candidates are never surfaced as Harness installs. */ }
    }
    this.installations = validated
    return this.list()
  }

  list(): ExternalInstallation[] {
    return [...this.installations.values()]
      .map(({ entry: _entry, npmPrefix: _npmPrefix, ...item }) => item)
      .sort((a, b) => a.packageRoot.localeCompare(b.packageRoot))
  }

  async resolve(id: string): Promise<ResolvedDsh> {
    const item = this.installations.get(id)
    if (!item) throw new Error('既有 Harness 安装不存在或尚未通过验证')
    return { version: item.version, root: item.packageRoot, entry: item.entry, source: 'external' }
  }

  async uninstall(id: string): Promise<void> {
    const item = this.installations.get(id)
    if (!item) throw new Error('既有 Harness 安装不存在或尚未通过验证')
    if (!item.canUninstall || !item.npmPrefix) throw new Error('该既有 Harness 安装为只读，不能由管理器卸载')
    await this.processRunner(this.runtime.node, [
      this.runtime.npmCli, 'uninstall', '--global', officialPackageName, '--prefix', item.npmPrefix
    ], { timeoutMs: 120_000 })
    this.installations.delete(id)
  }

  private async validate(candidate: ExternalCandidate): Promise<ValidatedInstallation> {
    const canonicalRoot = await realpath(candidate.packageRoot)
    const manifest = JSON.parse(await readFile(path.join(canonicalRoot, 'package.json'), 'utf8')) as PackageManifest
    if (manifest.name !== officialPackageName || !exactVersionSchema.safeParse(manifest.version).success) throw new Error('非官方 Harness 包')
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
    if (!bin) throw new Error('Harness 包缺少 CLI')
    const entry = await realpath(path.resolve(canonicalRoot, bin))
    if (!isInside(canonicalRoot, entry) || !(await stat(entry)).isFile()) throw new Error('Harness CLI 逃逸包目录')
    const npmPrefix = candidate.source === 'npm-global' && candidate.npmPrefix ? path.resolve(candidate.npmPrefix) : null
    const readOnly = candidate.source === 'project' || candidate.source === 'path'
    return {
      id: installationId(canonicalRoot),
      version: manifest.version!,
      packageRoot: canonicalRoot,
      entry,
      source: candidate.source,
      readOnly,
      canUninstall: candidate.source === 'npm-global' && npmPrefix !== null,
      reason: candidate.source === 'project'
        ? '项目内依赖仅供识别，不能原地修改'
        : candidate.source === 'path'
          ? 'PATH 来源不明确，仅供识别'
          : null,
      npmPrefix
    }
  }

  private async defaultCandidates(): Promise<ExternalCandidate[]> {
    const candidates: ExternalCandidate[] = []
    const explicit = process.env.DSH_BIN?.trim()
    if (explicit) candidates.push({ packageRoot: packageRootFromHint(explicit), source: 'environment' })

    const prefixes = new Set<string>()
    const appData = process.env.APPDATA?.trim()
    if (appData) prefixes.add(path.join(appData, 'npm'))
    const configuredPrefix = process.env.npm_config_prefix?.trim()
    if (configuredPrefix && path.isAbsolute(configuredPrefix)) prefixes.add(configuredPrefix)
    for (const prefix of prefixes) {
      candidates.push({ packageRoot: path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh'), source: 'npm-global', npmPrefix: prefix })
    }

    const pathValue = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1]
    for (const directory of pathValue?.split(path.delimiter).filter(Boolean) ?? []) {
      const hasShim = ['dsh', 'dsh.cmd', 'dsh.exe'].some((name) => existsSync(path.join(directory, name)))
      if (!hasShim) continue
      const candidate = rootFromBinDirectory(directory)
      if (candidate) candidates.push(candidate)
    }
    return candidates
  }

  private priority(source: ExternalInstallationSource): number {
    return ({ project: 0, path: 1, environment: 2, 'npm-global': 3 })[source]
  }
}
