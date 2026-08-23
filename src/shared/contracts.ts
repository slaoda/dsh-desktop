import { z } from 'zod'
import semver from 'semver'
export { channels } from './ipc-channels'

export const officialPackageName = '@deepseek-ai/dsh' as const
export const bundledDshVersion = '0.1.1-rc.2' as const

export const exactVersionSchema = z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/).refine((value) => semver.valid(value) !== null)
export const localePreferenceSchema = z.enum(['system', 'zh-CN', 'en-US'])
export const releaseChannelSchema = z.enum(['stable', 'preview', 'all'])
export const registryUrlSchema = z.string().trim().min(1).max(2_048).superRefine((value, context) => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) context.addIssue({ code: 'custom', message: '镜像地址必须使用 HTTP 或 HTTPS' })
    if (url.username || url.password) context.addIssue({ code: 'custom', message: '镜像地址不能包含用户名或密码' })
    if (url.search || url.hash) context.addIssue({ code: 'custom', message: '镜像地址不能包含查询参数或片段' })
  } catch {
    context.addIssue({ code: 'custom', message: '镜像地址格式无效' })
  }
}).transform((value) => value.replace(/\/+$/, ''))
export const clipboardTextSchema = z.string().min(1).max(4_096)
export const backupScopeSchema = z.enum(['configuration', 'full'])
export const backupIdSchema = z.string().regex(/^\d{8}T\d{9}Z-[0-9a-f]{8}$/)
export const externalInstallationIdSchema = z.string().regex(/^[0-9a-f]{16}$/)
export const repairModeSchema = z.enum(['auto', 'ask', 'diagnose'])
export const pluginEntryIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/)
export const pluginPackageNameSchema = z.string().min(1).max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i)
export const proxyModeSchema = z.enum(['system', 'manual'])
export const proxyUrlSchema = z.string().trim().min(1).max(2_048).superRefine((value, context) => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(url.protocol)) context.addIssue({ code: 'custom', message: '代理地址协议无效' })
    if (!url.hostname) context.addIssue({ code: 'custom', message: '代理地址缺少主机名' })
    if (url.username || url.password) context.addIssue({ code: 'custom', message: '手动代理不能包含用户名或密码，请使用系统代理处理认证' })
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) context.addIssue({ code: 'custom', message: '代理地址不能包含路径、查询参数或片段' })
  } catch {
    context.addIssue({ code: 'custom', message: '代理地址格式无效' })
  }
}).transform((value) => value.replace(/\/$/, ''))
export const defaultRegistryUrl = 'https://registry.npmjs.org' as const

export type AppLocale = 'zh-CN' | 'en-US'
export type LocalePreference = z.infer<typeof localePreferenceSchema>
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>
export type BackupScope = z.infer<typeof backupScopeSchema>
export type BackupReason = 'manual' | 'update' | 'pre-restore' | 'pre-repair'
export type ProxyMode = z.infer<typeof proxyModeSchema>
export type RepairMode = z.infer<typeof repairModeSchema>

export type RepairCategory =
  | 'plugin-conflict'
  | 'plugin-missing'
  | 'plugin-config'
  | 'managed-install-corrupt'
  | 'stale-process'
  | 'runtime-unhealthy'
  | 'sensitive-config'
  | 'external-installation'
  | 'unknown'

export type RepairConfidence = 'high' | 'medium' | 'low'

export type RepairAction =
  | {
    kind: 'quarantine-plugin'
    entryId: string
    packageName: string | null
    reversible: true
    requiresConfirmation: false
  }
  | {
    kind: 'quarantine-config-layer'
    layer: 'profile' | 'home'
    reversible: true
    requiresConfirmation: true
  }
  | {
    kind: 'reinstall-managed-version'
    version: string
    reversible: true
    requiresConfirmation: false
  }

export interface RepairCandidate {
  entryId?: string
  packageName?: string
  layer?: 'profile' | 'home'
}

export interface RepairDiagnosis {
  category: RepairCategory
  confidence: RepairConfidence
  summary: string
  evidence: string[]
  candidate: RepairCandidate | null
  action: RepairAction | null
}

export type RepairPhase = 'preflight' | 'starting' | 'diagnosing' | 'awaiting-confirmation' | 'repairing' | 'retrying' | 'recovered' | 'completed' | 'failed'
export type RepairOutcome = 'not-needed' | 'recovered' | 'failed' | 'awaiting-confirmation' | null

export interface RepairActionSummary {
  kind: RepairAction['kind']
  target: string
  status: 'applied' | 'rolled-back' | 'failed'
  summary: string
}

export interface QuarantinedPluginSummary {
  entryId: string
  packageName: string | null
  disposition: 'pending' | 'kept'
  createdAt: string
}

export interface RepairSessionSummary {
  id: string
  phase: RepairPhase
  outcome: RepairOutcome
  diagnosis: RepairDiagnosis | null
  actions: RepairActionSummary[]
  repairAttempts: 0 | 1
  retryAttempts: 0 | 1
  quarantinedPlugin: QuarantinedPluginSummary | null
}

export interface BackupSummary {
  id: string
  createdAt: string
  reason: BackupReason
  scope: BackupScope
  fileCount: number
  bytes: number
}

export type ExternalInstallationSource = 'environment' | 'npm-global' | 'path' | 'project'

export interface ExternalInstallation {
  id: string
  version: string
  packageRoot: string
  source: ExternalInstallationSource
  readOnly: boolean
  canUninstall: boolean
  reason: string | null
}

export function resolveLocale(preference: LocalePreference, systemLocale: AppLocale): AppLocale {
  return preference === 'system' ? systemLocale : preference
}

export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'failed'

export interface InstalledVersion {
  version: string
  source: 'bundled' | 'installed'
}

export interface OfficialVersion {
  version: string
  publishedAt: string | null
}

export interface AppSnapshot {
  appVersion: string
  locale: AppLocale
  localePreference: LocalePreference
  releaseChannel: ReleaseChannel
  registryUrl: string
  harnessHome: string | null
  backups: BackupSummary[]
  externalInstallations: ExternalInstallation[]
  closeToTray: boolean
  startAtLogin: boolean
  proxyMode: ProxyMode
  manualProxyUrl: string | null
  nodeVersion: string | null
  latestVersion: string | null
  selectedVersion: string | null
  selectedExternalId: string | null
  dismissedLatest: string | null
  installedVersions: InstalledVersion[]
  availableVersions: OfficialVersion[]
  runtimeStatus: RuntimeStatus
  runtimeUrl: string | null
  error: string | null
}

export interface InstallProgress {
  version: string
  phase: 'downloading' | 'validating' | 'complete' | 'failed'
  message: string
}

export interface DesktopApi {
  getSnapshot(): Promise<AppSnapshot>
  refresh(): Promise<AppSnapshot>
  install(version: string): Promise<AppSnapshot>
  uninstall(version: string): Promise<AppSnapshot>
  select(version: string): Promise<AppSnapshot>
  launch(): Promise<AppSnapshot>
  stop(): Promise<AppSnapshot>
  dismissUpdate(version: string): Promise<AppSnapshot>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  setLocale(preference: LocalePreference): Promise<AppSnapshot>
  setVersionPreferences(channel: ReleaseChannel, registryUrl: string): Promise<AppSnapshot>
  createBackup(scope: BackupScope): Promise<AppSnapshot>
  restoreBackup(id: string, scope: BackupScope): Promise<AppSnapshot>
  refreshExternalInstallations(): Promise<AppSnapshot>
  selectExternalInstallation(id: string): Promise<AppSnapshot>
  uninstallExternalInstallation(id: string): Promise<AppSnapshot>
  setDesktopPreferences(closeToTray: boolean, startAtLogin: boolean): Promise<AppSnapshot>
  setNetworkPreferences(mode: ProxyMode, manualProxyUrl: string | null): Promise<AppSnapshot>
  openDiagnosticsDirectory(): Promise<void>
  onStateChanged(listener: (snapshot: AppSnapshot) => void): () => void
  onInstallProgress(listener: (progress: InstallProgress) => void): () => void
}
