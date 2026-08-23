import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pluginEntryIdSchema, pluginPackageNameSchema, type BackupReason, type BackupScope } from '../../shared/contracts'
import { redactDiagnostic } from '../diagnostic-logger'
import { dshChildEnvironment, type DshStartOptions } from '../dsh-supervisor'
import { runProcess } from '../process-utils'
import type { ResolvedDsh } from '../version-manager'
import type { DshPreflightResult } from './dsh-preflight'
import type { PluginQuarantineStore, QuarantineRecord } from './plugin-quarantine'
import type { RepairTransactionStore } from './repair-transaction'

const maxProfilePackageBytes = 1_048_576

interface PluginActionSupervisor {
  stop(): Promise<void>
  start(dsh: ResolvedDsh, options?: DshStartOptions): Promise<string>
}

interface PluginActionPreflight {
  inspect(dsh: ResolvedDsh, overlay: string | null): Promise<DshPreflightResult>
}

interface PluginActionBackups {
  hasSource(): Promise<boolean>
  create(reason: BackupReason, scope: BackupScope): Promise<unknown>
}

export type PluginPackageUninstaller = (dsh: ResolvedDsh, packageName: string) => Promise<void>

export interface PluginRepairActionDependencies {
  quarantine: PluginQuarantineStore
  transactions: RepairTransactionStore
  preflight: PluginActionPreflight
  supervisor: PluginActionSupervisor
  backups: PluginActionBackups | null
  harnessHome: string
  uninstallPackage: PluginPackageUninstaller
}

export function createOfficialPluginUninstaller(
  nodePath: string,
  runtimePathEntries: string[]
): PluginPackageUninstaller {
  return async (dsh, packageName) => {
    if (dsh.source === 'external') throw new Error('外部 Harness 不允许卸载插件')
    const validatedPackage = pluginPackageNameSchema.parse(packageName)
    try {
      await runProcess(nodePath, [dsh.entry, 'plugin', '--profile', 'web', 'remove', validatedPackage], {
        cwd: os.homedir(),
        env: dshChildEnvironment(process.env, dsh, nodePath, runtimePathEntries),
        timeoutMs: 120_000
      })
    } catch (error) {
      throw new Error(redactDiagnostic(error instanceof Error ? error.message : '官方插件卸载失败'))
    }
  }
}

export class PluginRepairActions {
  private readonly harnessHome: string

  constructor(private readonly dependencies: PluginRepairActionDependencies) {
    this.harnessHome = path.resolve(dependencies.harnessHome)
  }

  async keep(entryId: string): Promise<QuarantineRecord> {
    return await this.dependencies.quarantine.keep(pluginEntryIdSchema.parse(entryId))
  }

  async reenable(dsh: ResolvedDsh, entryId: string): Promise<{ url: string }> {
    if (dsh.source === 'external') throw new Error('外部 Harness 不允许修改插件隔离')
    const validatedId = pluginEntryIdSchema.parse(entryId)
    const previous = await this.dependencies.quarantine.find(validatedId)
    if (!previous) throw new Error('插件隔离记录不存在')
    await this.dependencies.supervisor.stop()
    let transactionStarted = false
    try {
      await this.dependencies.transactions.beginPluginQuarantine({
        repairId: randomUUID(), entryId: validatedId, packageName: previous.packageName, previous
      })
      transactionStarted = true
      await this.dependencies.quarantine.remove(validatedId)
      await this.dependencies.transactions.mark('applied')
      const overlay = await this.dependencies.quarantine.overlayPath()
      await this.dependencies.preflight.inspect(dsh, overlay)
      await this.dependencies.transactions.mark('retrying')
      const url = await this.dependencies.supervisor.start(dsh, { repairOverlay: overlay })
      await this.dependencies.transactions.complete()
      return { url }
    } catch (error) {
      if (transactionStarted) await this.dependencies.transactions.recover(this.dependencies.quarantine)
      await this.restartSafely(dsh)
      throw error
    }
  }

  async uninstall(dsh: ResolvedDsh, entryId: string): Promise<{ url: string; packageName: string }> {
    if (dsh.source === 'external') throw new Error('外部 Harness 不允许卸载插件')
    const validatedId = pluginEntryIdSchema.parse(entryId)
    const record = await this.dependencies.quarantine.find(validatedId)
    if (!record?.packageName) throw new Error('无法确认隔离插件的包来源')
    const packageName = pluginPackageNameSchema.parse(record.packageName)
    await this.assertDirectProfileDependency(packageName)
    if (!this.dependencies.backups || !await this.dependencies.backups.hasSource()) throw new Error('无法创建插件卸载安全备份')
    await this.dependencies.supervisor.stop()
    await this.dependencies.backups.create('pre-repair', 'configuration')
    let removed = false
    try {
      await this.dependencies.uninstallPackage(dsh, packageName)
      await this.dependencies.quarantine.remove(validatedId)
      removed = true
      const overlay = await this.dependencies.quarantine.overlayPath()
      await this.dependencies.preflight.inspect(dsh, overlay)
      const url = await this.dependencies.supervisor.start(dsh, { repairOverlay: overlay })
      return { url, packageName }
    } catch (error) {
      if (!removed) await this.restartSafely(dsh)
      throw error
    }
  }

  private async assertDirectProfileDependency(packageName: string): Promise<void> {
    const packageFile = path.join(this.harnessHome, 'profiles', 'web', 'package.json')
    const info = await lstat(packageFile)
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxProfilePackageBytes) throw new Error('Web Profile 包清单无效')
    const parsed = JSON.parse(await readFile(packageFile, 'utf8')) as Record<string, unknown>
    const dependencies = parsed.dependencies && typeof parsed.dependencies === 'object'
      ? parsed.dependencies as Record<string, unknown>
      : {}
    if (!Object.prototype.hasOwnProperty.call(dependencies, packageName) || typeof dependencies[packageName] !== 'string') {
      throw new Error(`插件包 ${packageName} 不是 Web Profile 的直接依赖，拒绝卸载`)
    }
  }

  private async restartSafely(dsh: ResolvedDsh): Promise<void> {
    try {
      const overlay = await this.dependencies.quarantine.overlayPath()
      await this.dependencies.preflight.inspect(dsh, overlay)
      await this.dependencies.supervisor.start(dsh, { repairOverlay: overlay })
    } catch {
      // The original action error is more useful; the manager snapshot still
      // exposes a failed runtime and the restored quarantine record.
    }
  }
}
