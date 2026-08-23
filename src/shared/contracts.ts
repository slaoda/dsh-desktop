import { z } from 'zod'
import semver from 'semver'
export { channels } from './ipc-channels'

export const officialPackageName = '@deepseek-ai/dsh' as const
export const bundledDshVersion = '0.1.0-rc.6' as const

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
export const defaultRegistryUrl = 'https://registry.npmjs.org' as const

export type AppLocale = 'zh-CN' | 'en-US'
export type LocalePreference = z.infer<typeof localePreferenceSchema>
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>
export type BackupScope = z.infer<typeof backupScopeSchema>
export type BackupReason = 'manual' | 'update' | 'pre-restore'

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

export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'unsupported'
export type AppUpdateDelivery = 'automatic' | 'manual'

export interface AppUpdateSnapshot {
  currentVersion: string
  availableVersion: string | null
  delivery: AppUpdateDelivery
  status: AppUpdateStatus
  percent: number | null
  message: string | null
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
  getAppUpdate(): Promise<AppUpdateSnapshot>
  checkAppUpdate(): Promise<AppUpdateSnapshot>
  downloadAppUpdate(): Promise<AppUpdateSnapshot>
  installAppUpdate(): Promise<void>
  onStateChanged(listener: (snapshot: AppSnapshot) => void): () => void
  onInstallProgress(listener: (progress: InstallProgress) => void): () => void
  onAppUpdateChanged(listener: (snapshot: AppUpdateSnapshot) => void): () => void
}
