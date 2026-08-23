import { EventEmitter } from 'node:events'
import path from 'node:path'
import semver from 'semver'
import type { AppLocale, AppSnapshot, BackupScope, InstallProgress, LocalePreference, OfficialVersion, ProxyMode, ReleaseChannel, RepairSessionSummary } from '../shared/contracts'
import { defaultRegistryUrl, exactVersionSchema, externalInstallationIdSchema, localePreferenceSchema, proxyModeSchema, proxyUrlSchema, registryUrlSchema, releaseChannelSchema, resolveLocale } from '../shared/contracts'
import { runProcess } from './process-utils'
import { DshRegistry } from './registry'
import type { RuntimePaths } from './runtime-paths'
import { StateStore, type PersistedState } from './state-store'
import { SwitchTransactionStore } from './switch-transaction'
import { DshSupervisor } from './dsh-supervisor'
import { VersionManager, type ResolvedDsh } from './version-manager'
import { BackupManager } from './backup-manager'
import { ExternalInstallationManager } from './external-installations'
import { RepairLaunchError, type StartupRepairEngine } from './repair/repair-engine'
import type { PluginRepairActions } from './repair/plugin-repair-actions'

export class AppController extends EventEmitter {
  private state: PersistedState = {
    schemaVersion: 5, selectedVersion: null, selectedExternalId: null, dismissedLatest: null, localePreference: 'system',
    releaseChannel: 'all', registryUrl: defaultRegistryUrl, closeToTray: true, startAtLogin: false, proxyMode: 'system', manualProxyUrl: null
  }
  private latestVersion: string | null = null
  private availableVersions: OfficialVersion[] = []
  private nodeVersion: string | null = null
  private error: string | null = null
  private repairSession: RepairSessionSummary | null = null
  private versionOperationInProgress = false

  constructor(
    private readonly appVersion: string,
    private readonly store: StateStore,
    private readonly registry: DshRegistry,
    private readonly versions: VersionManager,
    private readonly supervisor: DshSupervisor,
    private readonly runtime: RuntimePaths,
    private readonly systemLocale: AppLocale = 'zh-CN',
    private readonly switchTransactions: SwitchTransactionStore = new SwitchTransactionStore(path.dirname(store.file)),
    private readonly backups: BackupManager | null = null,
    private readonly externalInstallations: ExternalInstallationManager | null = null,
    private readonly applyNetworkPreferences: ((mode: ProxyMode, manualProxyUrl: string | null) => Promise<void>) | null = null,
    private readonly repairEngine: StartupRepairEngine | null = null,
    private readonly pluginRepairActions: PluginRepairActions | null = null
  ) {
    super()
    supervisor.on('status', () => { void this.emitSnapshot() })
    repairEngine?.on('session', (session) => {
      this.repairSession = session
      void this.emitSnapshot()
    })
  }

  async initialize(): Promise<AppSnapshot> {
    this.state = await this.store.read()
    await this.versions.cleanupInterruptedInstalls()
    if (await this.repairEngine?.recoverInterrupted()) this.error = '检测到未完成的启动修复，已恢复修复前状态'
    if (this.externalInstallations) {
      try { await this.externalInstallations.refresh() } catch (error) {
        this.error = error instanceof Error ? `检测既有 Harness 安装失败：${error.message}` : '检测既有 Harness 安装失败'
      }
    }
    await this.recoverInterruptedSwitch()
    try {
      const result = await runProcess(this.runtime.node, ['--version'], { timeoutMs: 5_000 })
      this.nodeVersion = result.stdout.trim()
    } catch {
      this.error = '内置 Node.js 运行环境不可用'
    }
    await this.ensureSelection()
    return await this.snapshot()
  }

  async refresh(): Promise<AppSnapshot> {
    try {
      const catalog = await this.registry.catalog({ channel: this.state.releaseChannel, registryUrl: this.state.registryUrl })
      this.latestVersion = catalog.latest
      this.availableVersions = catalog.versions
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : '检查版本失败'
    }
    await this.ensureSelection()
    return await this.emitSnapshot()
  }

  async install(version: string): Promise<AppSnapshot> {
    if (this.versionOperationInProgress) throw new Error('已有 DSH 版本操作正在进行')
    exactVersionSchema.parse(version)
    this.versionOperationInProgress = true
    try {
      if (this.availableVersions.length === 0) {
        const catalog = await this.registry.catalog({ channel: this.state.releaseChannel, registryUrl: this.state.registryUrl })
        this.latestVersion = catalog.latest
        this.availableVersions = catalog.versions
      }
      await this.versions.install(version, this.availableVersions.map((item) => item.version), (progress) => this.emit('progress', progress), this.state.registryUrl)
      if (!this.state.selectedVersion) {
        this.state.selectedVersion = version
        await this.store.write(this.state)
      }
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : '安装失败'
      throw error
    } finally {
      this.versionOperationInProgress = false
      await this.emitSnapshot()
    }
    return await this.snapshot()
  }

  async uninstall(version: string): Promise<AppSnapshot> {
    if (this.versionOperationInProgress) throw new Error('已有 DSH 版本操作正在进行')
    exactVersionSchema.parse(version)
    if (!this.state.selectedExternalId && this.state.selectedVersion === version) throw new Error('无法卸载当前使用的 DSH 版本，请先切换到其他版本')
    this.versionOperationInProgress = true
    try {
      await this.versions.uninstall(version)
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : '卸载失败'
      throw error
    } finally {
      this.versionOperationInProgress = false
      await this.emitSnapshot()
    }
    return await this.snapshot()
  }

  async select(version: string): Promise<AppSnapshot> {
    exactVersionSchema.parse(version)
    if (this.supervisor.status !== 'idle' && this.supervisor.status !== 'failed') throw new Error('请先停止正在运行的 DSH')
    await this.versions.resolve(version)
    this.state.selectedVersion = version
    this.state.selectedExternalId = null
    await this.store.write(this.state)
    this.error = null
    return await this.emitSnapshot()
  }

  async switchAndLaunch(version: string): Promise<AppSnapshot> {
    exactVersionSchema.parse(version)
    const candidate = await this.versions.resolve(version)
    return await this.switchResolvedAndLaunch(candidate, null)
  }

  async launch(): Promise<AppSnapshot> {
    if (!this.state.selectedVersion) throw new Error('请先安装并选择一个 DSH 版本')
    try {
      let resolved: ResolvedDsh
      try {
        resolved = await this.resolveSelection(this.state.selectedVersion, this.state.selectedExternalId)
      } catch (resolutionError) {
        if (!this.repairEngine || this.state.selectedExternalId) throw resolutionError
        const result = await this.repairEngine.repairManagedVersion(
          this.state.selectedVersion, resolutionError, 'auto', this.state.registryUrl
        )
        this.repairSession = result.session
        this.error = null
        return await this.snapshot()
      }
      if (this.repairEngine) {
        const result = await this.repairEngine.launch(resolved, 'auto')
        this.repairSession = result.session
      } else {
        await this.supervisor.start(resolved)
        this.repairSession = null
      }
      this.error = null
    } catch (error) {
      if (error instanceof RepairLaunchError) this.repairSession = error.session
      this.error = error instanceof Error ? error.message : '启动失败'
      throw error
    } finally {
      await this.emitSnapshot()
    }
    return await this.snapshot()
  }

  async stop(): Promise<AppSnapshot> {
    await this.supervisor.stop()
    return await this.emitSnapshot()
  }

  async dismissUpdate(version: string): Promise<AppSnapshot> {
    exactVersionSchema.parse(version)
    this.state.dismissedLatest = version
    await this.store.write(this.state)
    return await this.emitSnapshot()
  }

  async setLocale(preference: LocalePreference): Promise<AppSnapshot> {
    this.state.localePreference = localePreferenceSchema.parse(preference)
    await this.store.write(this.state)
    return await this.emitSnapshot()
  }

  async setVersionPreferences(channel: ReleaseChannel, registryUrl: string): Promise<AppSnapshot> {
    this.state.releaseChannel = releaseChannelSchema.parse(channel)
    this.state.registryUrl = registryUrlSchema.parse(registryUrl)
    await this.store.write(this.state)
    this.latestVersion = null
    this.availableVersions = []
    return await this.refresh()
  }

  async createBackup(scope: BackupScope): Promise<AppSnapshot> {
    if (!this.backups) throw new Error('Harness 备份功能不可用')
    if (this.isRuntimeActive()) throw new Error('创建备份前请先停止正在运行的 DSH')
    if (!await this.backups.hasSource()) throw new Error('尚未找到可备份的 Harness 主目录')
    await this.backups.create('manual', scope)
    this.error = null
    return await this.emitSnapshot()
  }

  async restoreBackup(id: string, scope: BackupScope): Promise<AppSnapshot> {
    if (!this.backups) throw new Error('Harness 备份功能不可用')
    if (this.isRuntimeActive()) throw new Error('恢复备份前请先停止正在运行的 DSH')
    if (await this.backups.hasSource()) await this.backups.create('pre-restore', 'full')
    await this.backups.restore(id, scope)
    this.error = null
    return await this.emitSnapshot()
  }

  async refreshExternalInstallations(): Promise<AppSnapshot> {
    if (!this.externalInstallations) throw new Error('既有 Harness 安装检测不可用')
    await this.externalInstallations.refresh()
    await this.ensureSelection()
    this.error = null
    return await this.emitSnapshot()
  }

  async selectExternalInstallation(id: string): Promise<AppSnapshot> {
    if (!this.externalInstallations) throw new Error('既有 Harness 安装检测不可用')
    const validatedId = externalInstallationIdSchema.parse(id)
    const item = this.externalInstallations.list().find((candidate) => candidate.id === validatedId)
    if (!item) throw new Error('既有 Harness 安装不存在或尚未通过验证')
    if (item.readOnly) throw new Error(item.reason ?? '该既有 Harness 安装仅供查看')
    return await this.switchResolvedAndLaunch(await this.externalInstallations.resolve(validatedId), validatedId)
  }

  async uninstallExternalInstallation(id: string): Promise<AppSnapshot> {
    if (!this.externalInstallations) throw new Error('既有 Harness 安装检测不可用')
    const validatedId = externalInstallationIdSchema.parse(id)
    if (this.state.selectedExternalId === validatedId) throw new Error('无法卸载当前使用的既有 Harness，请先切换到其他版本')
    await this.externalInstallations.uninstall(validatedId)
    this.error = null
    return await this.emitSnapshot()
  }

  async setDesktopPreferences(closeToTray: boolean, startAtLogin: boolean): Promise<AppSnapshot> {
    if (typeof closeToTray !== 'boolean' || typeof startAtLogin !== 'boolean') throw new Error('桌面偏好设置无效')
    this.state.closeToTray = closeToTray
    this.state.startAtLogin = startAtLogin
    await this.store.write(this.state)
    return await this.emitSnapshot()
  }

  async setNetworkPreferences(mode: ProxyMode, manualProxyUrl: string | null): Promise<AppSnapshot> {
    const validatedMode = proxyModeSchema.parse(mode)
    const validatedUrl = validatedMode === 'manual' ? proxyUrlSchema.parse(manualProxyUrl) : null
    if (this.applyNetworkPreferences) await this.applyNetworkPreferences(validatedMode, validatedUrl)
    this.state.proxyMode = validatedMode
    this.state.manualProxyUrl = validatedUrl
    await this.store.write(this.state)
    this.error = null
    return await this.emitSnapshot()
  }

  async keepQuarantinedPlugin(entryId: string): Promise<AppSnapshot> {
    if (!this.pluginRepairActions) throw new Error('插件修复操作不可用')
    try {
      const record = await this.pluginRepairActions.keep(entryId)
      if (this.repairSession?.quarantinedPlugin?.entryId === record.entryId) {
        this.repairSession = { ...this.repairSession, quarantinedPlugin: record }
      }
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : '保持插件禁用失败'
      throw error
    } finally {
      await this.emitSnapshot()
    }
    return await this.snapshot()
  }

  async reenableQuarantinedPlugin(entryId: string): Promise<AppSnapshot> {
    if (!this.pluginRepairActions) throw new Error('插件修复操作不可用')
    if (!this.state.selectedVersion) throw new Error('当前没有可用 Harness 版本')
    try {
      const resolved = await this.resolveSelection(this.state.selectedVersion, this.state.selectedExternalId)
      await this.pluginRepairActions.reenable(resolved, entryId)
      if (this.repairSession?.quarantinedPlugin?.entryId === entryId) {
        this.repairSession = { ...this.repairSession, phase: 'completed', outcome: 'not-needed', quarantinedPlugin: null }
      }
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : '重新启用插件失败'
      throw error
    } finally {
      await this.emitSnapshot()
    }
    return await this.snapshot()
  }

  async uninstallQuarantinedPlugin(entryId: string): Promise<AppSnapshot> {
    if (!this.pluginRepairActions) throw new Error('插件修复操作不可用')
    if (!this.state.selectedVersion) throw new Error('当前没有可用 Harness 版本')
    try {
      const resolved = await this.resolveSelection(this.state.selectedVersion, this.state.selectedExternalId)
      await this.pluginRepairActions.uninstall(resolved, entryId)
      if (this.repairSession?.quarantinedPlugin?.entryId === entryId) {
        this.repairSession = { ...this.repairSession, phase: 'completed', outcome: 'not-needed', quarantinedPlugin: null }
      }
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : '卸载冲突插件失败'
      throw error
    } finally {
      await this.emitSnapshot()
    }
    return await this.snapshot()
  }

  isRuntimeActive(): boolean {
    return !['idle', 'failed'].includes(this.supervisor.status)
  }

  getLocalePreference(): LocalePreference {
    return this.state.localePreference
  }

  async snapshot(): Promise<AppSnapshot> {
    const installedVersions = (await this.versions.list()).sort((a, b) => semver.rcompare(a.version, b.version))
    const availableVersions = [...this.availableVersions].sort((a, b) => semver.rcompare(a.version, b.version))
    const backups = this.backups ? await this.backups.list() : []
    const externalInstallations = this.externalInstallations?.list() ?? []
    return {
      appVersion: this.appVersion,
      locale: resolveLocale(this.state.localePreference, this.systemLocale),
      localePreference: this.state.localePreference,
      releaseChannel: this.state.releaseChannel,
      registryUrl: this.state.registryUrl,
      harnessHome: this.backups?.harnessHome ?? null,
      backups,
      externalInstallations,
      closeToTray: this.state.closeToTray,
      startAtLogin: this.state.startAtLogin,
      proxyMode: this.state.proxyMode,
      manualProxyUrl: this.state.manualProxyUrl,
      nodeVersion: this.nodeVersion,
      latestVersion: this.latestVersion,
      selectedVersion: this.state.selectedVersion,
      selectedExternalId: this.state.selectedExternalId,
      dismissedLatest: this.state.dismissedLatest,
      installedVersions,
      availableVersions,
      runtimeStatus: this.supervisor.status,
      runtimeUrl: this.supervisor.url,
      repairSession: this.repairSession,
      error: this.error
    }
  }

  private async ensureSelection(): Promise<void> {
    if (this.state.selectedExternalId && this.externalInstallations) {
      const selected = this.externalInstallations.list().find((item) => item.id === this.state.selectedExternalId && !item.readOnly)
      if (selected) {
        this.state.selectedVersion = selected.version
        await this.store.write(this.state)
        return
      }
      this.state.selectedExternalId = null
    }
    const versions = await this.versions.list()
    if (this.state.selectedVersion && versions.some((item) => item.version === this.state.selectedVersion)) return
    this.state.selectedVersion = versions.sort((a, b) => semver.rcompare(a.version, b.version))[0]?.version ?? null
    this.state.selectedExternalId = null
    await this.store.write(this.state)
  }

  private async recoverInterruptedSwitch(): Promise<void> {
    const pending = await this.switchTransactions.read()
    if (!pending) return
    this.state.selectedVersion = pending.previousVersion
    this.state.selectedExternalId = pending.previousExternalId
    await this.store.write(this.state)
    await this.switchTransactions.complete()
    this.error = pending.previousVersion
      ? `检测到未完成的版本切换，已恢复到 ${pending.previousVersion}`
      : '检测到未完成的首次版本启动，未提交候选版本'
  }

  private async resolveSelection(version: string, externalId: string | null): Promise<ResolvedDsh> {
    if (externalId) {
      if (!this.externalInstallations) throw new Error('当前既有 Harness 安装管理器不可用')
      return await this.externalInstallations.resolve(externalId)
    }
    return await this.versions.resolve(version)
  }

  private async switchResolvedAndLaunch(candidate: ResolvedDsh, candidateExternalId: string | null): Promise<AppSnapshot> {
    const previousVersion = this.state.selectedVersion
    const previousExternalId = this.state.selectedExternalId
    if (previousVersion === candidate.version && previousExternalId === candidateExternalId && this.supervisor.status === 'running') return await this.snapshot()
    if (this.isRuntimeActive()) await this.supervisor.stop()
    if (previousVersion && (previousVersion !== candidate.version || previousExternalId !== candidateExternalId) && this.backups && await this.backups.hasSource()) {
      try {
        await this.backups.create('update', 'full')
      } catch (backupError) {
        const detail = backupError instanceof Error ? backupError.message : '备份失败'
        try { await this.supervisor.start(await this.resolveSelection(previousVersion, previousExternalId)) } catch { /* Snapshot reports the stopped/failed runtime. */ }
        this.error = `切换到 ${candidate.version} 前的安全备份失败，已取消切换：${detail}`
        return await this.emitSnapshot()
      }
    }
    await this.switchTransactions.begin(previousVersion, candidate.version, previousExternalId, candidateExternalId)
    try {
      await this.supervisor.start(candidate)
      this.state.selectedVersion = candidate.version
      this.state.selectedExternalId = candidateExternalId
      await this.store.write(this.state)
      await this.switchTransactions.complete()
      this.error = null
    } catch (candidateError) {
      this.state.selectedVersion = previousVersion
      this.state.selectedExternalId = previousExternalId
      await this.store.write(this.state)
      await this.switchTransactions.complete()
      const detail = candidateError instanceof Error ? candidateError.message : '候选版本启动失败'
      if (previousVersion) {
        try {
          await this.supervisor.start(await this.resolveSelection(previousVersion, previousExternalId))
          this.error = `新版本 ${candidate.version} 启动失败，已自动回退到 ${previousVersion}：${detail}`
        } catch (rollbackError) {
          const rollbackDetail = rollbackError instanceof Error ? rollbackError.message : '旧版本启动失败'
          this.error = `新版本 ${candidate.version} 启动失败，选择已恢复到 ${previousVersion}，但旧版本未能启动：${detail}；${rollbackDetail}`
        }
      } else {
        this.error = `新版本 ${candidate.version} 启动失败：${detail}`
      }
    }
    return await this.emitSnapshot()
  }

  private async emitSnapshot(): Promise<AppSnapshot> {
    const snapshot = await this.snapshot()
    this.emit('snapshot', snapshot)
    return snapshot
  }
}

export type ControllerProgress = InstallProgress
