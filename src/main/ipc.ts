import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import {
  backupIdSchema,
  backupScopeSchema,
  channels,
  clipboardTextSchema,
  destructiveConfirmationSchema,
  exactVersionSchema,
  externalInstallationIdSchema,
  localePreferenceSchema,
  pluginEntryIdSchema,
  proxyModeSchema,
  proxyUrlSchema,
  registryUrlSchema,
  releaseChannelSchema,
  repairModeSchema
} from '../shared/contracts'
import type { AppController } from './controller'
import type { DiagnosticLogger } from './diagnostic-logger'

type ManagerGuard = (event: IpcMainInvokeEvent) => void
type OpenHarnessWindow = (url: string) => Promise<void>

function isSafeExternalUrl(raw: string): boolean {
  try { return new URL(raw).protocol === 'https:' } catch { return false }
}

export function registerIpc(
  controller: AppController,
  assertManager: ManagerGuard,
  openHarnessWindow: OpenHarnessWindow,
  diagnosticLogger: DiagnosticLogger
): void {
  ipcMain.handle(channels.snapshot, async (event) => { assertManager(event); return await controller.snapshot() })
  ipcMain.handle(channels.refresh, async (event) => { assertManager(event); return await controller.refresh() })
  ipcMain.handle(channels.install, async (event, version: unknown) => {
    assertManager(event)
    return await controller.install(exactVersionSchema.parse(version))
  })
  ipcMain.handle(channels.uninstall, async (event, version: unknown) => {
    assertManager(event)
    return await controller.uninstall(exactVersionSchema.parse(version))
  })
  ipcMain.handle(channels.select, async (event, version: unknown) => {
    assertManager(event)
    const snapshot = await controller.switchAndLaunch(exactVersionSchema.parse(version))
    if (!snapshot.runtimeUrl) throw new Error('官方 DSH 未返回本地地址')
    await openHarnessWindow(snapshot.runtimeUrl)
    return snapshot
  })
  ipcMain.handle(channels.launch, async (event) => {
    assertManager(event)
    const current = await controller.snapshot()
    const snapshot = current.runtimeStatus === 'running' && current.runtimeUrl ? current : await controller.launch()
    if (!snapshot.runtimeUrl) throw new Error('官方 DSH 未返回本地地址')
    await openHarnessWindow(snapshot.runtimeUrl)
    return snapshot
  })
  ipcMain.handle(channels.confirmStartupRepair, async (event) => {
    assertManager(event)
    const snapshot = await controller.confirmStartupRepair()
    if (!snapshot.runtimeUrl) throw new Error('修复后 Harness 未返回本地地址')
    await openHarnessWindow(snapshot.runtimeUrl)
    return snapshot
  })
  ipcMain.handle(channels.stop, async (event) => {
    assertManager(event)
    return await controller.stop()
  })
  ipcMain.handle(channels.dismissUpdate, async (event, version: unknown) => {
    assertManager(event)
    return await controller.dismissUpdate(exactVersionSchema.parse(version))
  })
  ipcMain.handle(channels.openExternal, async (event, raw: unknown) => {
    assertManager(event)
    if (typeof raw !== 'string' || !isSafeExternalUrl(raw)) throw new Error('只允许打开 HTTPS 链接')
    await shell.openExternal(raw)
  })
  ipcMain.handle(channels.copyText, (event, raw: unknown) => {
    assertManager(event)
    clipboard.writeText(clipboardTextSchema.parse(raw))
  })
  ipcMain.handle(channels.setLocale, async (event, raw: unknown) => {
    assertManager(event)
    return await controller.setLocale(localePreferenceSchema.parse(raw))
  })
  ipcMain.handle(channels.setVersionPreferences, async (event, rawChannel: unknown, rawRegistryUrl: unknown) => {
    assertManager(event)
    return await controller.setVersionPreferences(releaseChannelSchema.parse(rawChannel), registryUrlSchema.parse(rawRegistryUrl))
  })
  ipcMain.handle(channels.createBackup, async (event, rawScope: unknown) => {
    assertManager(event)
    return await controller.createBackup(backupScopeSchema.parse(rawScope))
  })
  ipcMain.handle(channels.restoreBackup, async (event, rawId: unknown, rawScope: unknown) => {
    assertManager(event)
    return await controller.restoreBackup(backupIdSchema.parse(rawId), backupScopeSchema.parse(rawScope))
  })
  ipcMain.handle(channels.refreshExternalInstallations, async (event) => {
    assertManager(event)
    return await controller.refreshExternalInstallations()
  })
  ipcMain.handle(channels.selectExternalInstallation, async (event, rawId: unknown) => {
    assertManager(event)
    const snapshot = await controller.selectExternalInstallation(externalInstallationIdSchema.parse(rawId))
    if (!snapshot.runtimeUrl) throw new Error('既有 Harness 未返回本地地址')
    await openHarnessWindow(snapshot.runtimeUrl)
    return snapshot
  })
  ipcMain.handle(channels.uninstallExternalInstallation, async (event, rawId: unknown) => {
    assertManager(event)
    return await controller.uninstallExternalInstallation(externalInstallationIdSchema.parse(rawId))
  })
  ipcMain.handle(channels.setDesktopPreferences, async (event, rawCloseToTray: unknown, rawStartAtLogin: unknown) => {
    assertManager(event)
    if (typeof rawCloseToTray !== 'boolean' || typeof rawStartAtLogin !== 'boolean') throw new Error('桌面偏好设置无效')
    return await controller.setDesktopPreferences(rawCloseToTray, rawStartAtLogin)
  })
  ipcMain.handle(channels.setNetworkPreferences, async (event, rawMode: unknown, rawManualProxyUrl: unknown) => {
    assertManager(event)
    const mode = proxyModeSchema.parse(rawMode)
    const manualProxyUrl = mode === 'manual' ? proxyUrlSchema.parse(rawManualProxyUrl) : null
    return await controller.setNetworkPreferences(mode, manualProxyUrl)
  })
  ipcMain.handle(channels.setRepairMode, async (event, rawMode: unknown) => {
    assertManager(event)
    return await controller.setRepairMode(repairModeSchema.parse(rawMode))
  })
  ipcMain.handle(channels.keepQuarantinedPlugin, async (event, rawEntryId: unknown) => {
    assertManager(event)
    return await controller.keepQuarantinedPlugin(pluginEntryIdSchema.parse(rawEntryId))
  })
  ipcMain.handle(channels.reenableQuarantinedPlugin, async (event, rawEntryId: unknown) => {
    assertManager(event)
    return await controller.reenableQuarantinedPlugin(pluginEntryIdSchema.parse(rawEntryId))
  })
  ipcMain.handle(channels.uninstallQuarantinedPlugin, async (event, rawEntryId: unknown, rawConfirmed: unknown) => {
    assertManager(event)
    destructiveConfirmationSchema.parse(rawConfirmed)
    return await controller.uninstallQuarantinedPlugin(pluginEntryIdSchema.parse(rawEntryId))
  })
  ipcMain.handle(channels.openDiagnosticsDirectory, async (event) => {
    assertManager(event)
    await diagnosticLogger.log('info', 'diagnostics-opened')
    const error = await shell.openPath(diagnosticLogger.directory)
    if (error) throw new Error(`无法打开诊断日志目录：${error}`)
  })
}
