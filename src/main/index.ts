import { app, BrowserWindow, Menu, net, Notification, session, shell, type Tray } from 'electron'
import os from 'node:os'
import path from 'node:path'
import semver from 'semver'
import { channels, proxyUrlSchema, type AppLocale, type AppSnapshot, type InstallProgress, type LocalePreference, type ProxyMode } from '../shared/contracts'
import { applyNetworkProxy, configureNetworkProxy } from './network-proxy'
import { AppController } from './controller'
import { DshSupervisor } from './dsh-supervisor'
import { DshRegistry } from './registry'
import { resolveRuntimePaths } from './runtime-paths'
import { StateStore } from './state-store'
import { VersionManager } from './version-manager'
import { BackupManager } from './backup-manager'
import { resolveHarnessHome } from './harness-home'
import { ExternalInstallationManager } from './external-installations'
import { DiagnosticLogger } from './diagnostic-logger'
import { DshPreflight } from './repair/dsh-preflight'
import { PluginQuarantineStore } from './repair/plugin-quarantine'
import { RepairBaselineStore } from './repair/repair-baseline'
import { RepairEngine } from './repair/repair-engine'
import { RepairTransactionStore } from './repair/repair-transaction'
import { mainCopy, normalizeSystemLocale } from './copy'
import { registerIpc } from './ipc'
import { DshUpdatePopover, hasDshUpdate } from './dsh-update-popover'
import { createTray, installApplicationMenu, updateAboutPanel, updateTrayMenu, type DesktopChromeActions } from './desktop-chrome'

const APP_NAME = 'DSH Desktop'
const DEEPSEEK_HARNESS_WINDOW_TITLE = 'DeepSeek Harness'
let managerWindow: BrowserWindow | null = null
let dshWindow: BrowserWindow | null = null
let latestSnapshotForWindowTitle: AppSnapshot | null = null
let controller: AppController | null = null
let isQuitting = false
let isOpeningPrimary = false
let notifiedVersion: string | null = null
let activeLocale: AppLocale = 'zh-CN'
let activeLocalePreference: LocalePreference = 'system'
let tray: Tray | null = null
let closeToTrayEnabled = true
let startAtLoginEnabled = false
let loginItemInitialized = false
let diagnosticLogger: DiagnosticLogger | null = null
let lastDiagnosticSignature = ''
const dshUpdatePopover = new DshUpdatePopover(() => showManagerWindow())
const chromeActions: DesktopChromeActions = {
  openHarness: () => { void openPrimaryWindow() },
  openManager: () => showManagerWindow(),
  stopHarness: () => { void controller?.stop() },
  quit: () => quitApplication(),
  setLocale: (preference) => { void controller?.setLocale(preference) }
}

app.setName(APP_NAME)

function isSafeExternalUrl(raw: string): boolean {
  try { return new URL(raw).protocol === 'https:' } catch { return false }
}

function sendToManager(channel: string, payload: AppSnapshot | InstallProgress): void {
  if (managerWindow && !managerWindow.isDestroyed()) managerWindow.webContents.send(channel, payload)
}

function dshWindowTitle(snapshot: AppSnapshot): string {
  const copy = mainCopy(snapshot.locale)
  if (!snapshot.selectedVersion) return DEEPSEEK_HARNESS_WINDOW_TITLE
  const currentVersion = `v${snapshot.selectedVersion}`
  if (snapshot.selectedVersion && snapshot.latestVersion && semver.gt(snapshot.latestVersion, snapshot.selectedVersion)) {
    return `${DEEPSEEK_HARNESS_WINDOW_TITLE} · ${currentVersion} · ${copy.dshWindowUpdateTag(snapshot.latestVersion)}`
  }
  return `${DEEPSEEK_HARNESS_WINDOW_TITLE} · ${currentVersion}`
}

function setDshWindowTitle(snapshot: AppSnapshot): void {
  if (!dshWindow || dshWindow.isDestroyed()) return
  dshWindow.setTitle(dshWindowTitle(snapshot))
}

function updateMenuDshUpdateHint(snapshot: AppSnapshot): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const item = menu.getMenuItemById('quick-update-dsh')
  if (!item) return
  if (!hasDshUpdate(snapshot)) {
    const copy = mainCopy(snapshot.locale)
    item.enabled = false
    item.label = copy.versionManager
    return
  }
  const copy = mainCopy(snapshot.locale)
  item.enabled = true
  item.label = copy.openDshUpdateManager(snapshot.latestVersion)
}

function createManagerWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'DSH Desktop',
    backgroundColor: '#f4f1e8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (current && new URL(url).origin !== new URL(current).origin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.on('close', (event) => {
    if (isQuitting || !closeToTrayEnabled) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => { managerWindow = null })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  return window
}

function showManagerWindow(): void {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show()
    managerWindow.focus()
    return
  }
  managerWindow = createManagerWindow()
}

function refreshTray(snapshot: AppSnapshot | null = latestSnapshotForWindowTitle): void {
  if (tray) updateTrayMenu(tray, snapshot, activeLocale, controller !== null, chromeActions)
}

function ensureTray(): void {
  if (!tray) tray = createTray(chromeActions)
  refreshTray()
}

function refreshApplicationChrome(): void {
  installApplicationMenu(activeLocale, controller !== null, chromeActions)
  updateAboutPanel(activeLocale)
}

function applyDesktopPreferences(snapshot: AppSnapshot): void {
  closeToTrayEnabled = snapshot.closeToTray
  if (!loginItemInitialized || startAtLoginEnabled !== snapshot.startAtLogin) {
    loginItemInitialized = true
    startAtLoginEnabled = snapshot.startAtLogin
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: startAtLoginEnabled })
  }
}

function quitApplication(): void {
  if (isQuitting) return
  isQuitting = true
  const finish = (): void => app.quit()
  if (controller?.isRuntimeActive()) void controller.stop().finally(finish)
  else finish()
}

function notifyDshUpdate(snapshot: AppSnapshot): void {
  if (!snapshot.latestVersion || !snapshot.selectedVersion || snapshot.dismissedLatest === snapshot.latestVersion) return
  if (!semver.gt(snapshot.latestVersion, snapshot.selectedVersion) || notifiedVersion === snapshot.latestVersion) return
  notifiedVersion = snapshot.latestVersion
  if (!Notification.isSupported()) return
  const copy = mainCopy(activeLocale)
  const notification = new Notification({
    title: copy.dshUpdateTitle(snapshot.latestVersion),
    body: copy.dshUpdateBody(snapshot.selectedVersion)
  })
  notification.on('click', showManagerWindow)
  notification.show()
}

async function openDshWindow(rawUrl: string): Promise<void> {
  const parsedUrl = new URL(rawUrl)
  const allowedOrigin = parsedUrl.origin
  if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1' || !parsedUrl.port || parsedUrl.username || parsedUrl.password) {
    throw new Error('拒绝打开未经验证的 DSH 地址')
  }
  if (dshWindow && !dshWindow.isDestroyed()) {
    dshWindow.show()
    dshWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    title: latestSnapshotForWindowTitle ? dshWindowTitle(latestSnapshotForWindowTitle) : DEEPSEEK_HARNESS_WINDOW_TITLE,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: 'persist:dsh-web'
    }
  })
  dshWindow = window
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault()
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-finish-load', () => {
    if (latestSnapshotForWindowTitle) setDshWindowTitle(latestSnapshotForWindowTitle)
    if (process.env.DSH_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'right' })
    }
  })
  window.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    if (latestSnapshotForWindowTitle) setDshWindowTitle(latestSnapshotForWindowTitle)
    else window.setTitle(DEEPSEEK_HARNESS_WINDOW_TITLE)
  })
  window.on('focus', () => {
    if (latestSnapshotForWindowTitle) setDshWindowTitle(latestSnapshotForWindowTitle)
  })
  window.on('move', () => dshUpdatePopover.position(window))
  window.on('resize', () => dshUpdatePopover.position(window))
  window.on('minimize', () => dshUpdatePopover.hide())
  window.on('restore', () => {
    if (latestSnapshotForWindowTitle) dshUpdatePopover.show(window, latestSnapshotForWindowTitle)
  })
  window.on('close', (event) => {
    if (isQuitting || !closeToTrayEnabled) return
    event.preventDefault()
    dshUpdatePopover.hide()
    window.hide()
  })
  window.on('closed', () => {
    dshUpdatePopover.close()
    dshWindow = null
    if (controller?.isRuntimeActive()) void controller.stop()
  })
  await window.loadURL(rawUrl)
  if (latestSnapshotForWindowTitle) {
    setDshWindowTitle(latestSnapshotForWindowTitle)
    dshUpdatePopover.show(window, latestSnapshotForWindowTitle)
  }
}

async function openPrimaryWindow(): Promise<void> {
  if (!controller || isOpeningPrimary) return
  isOpeningPrimary = true
  try {
    const current = await controller.snapshot()
    if (current.runtimeStatus === 'running' && current.runtimeUrl) {
      await openDshWindow(current.runtimeUrl)
      return
    }
    const launched = await controller.launch()
    if (!launched.runtimeUrl) throw new Error('官方 DSH 未返回本地地址')
    await openDshWindow(launched.runtimeUrl)
  } catch {
    showManagerWindow()
  } finally {
    isOpeningPrimary = false
  }
}

refreshApplicationChrome()

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.dsh.desktop')
  const proxy = await configureNetworkProxy(session.defaultSession)
  await session.fromPartition('persist:dsh-web').setProxy({ mode: 'direct' })
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'build-resources')
  const runtime = resolveRuntimePaths(resourcesRoot, app.isPackaged)
  const store = new StateStore(app.getPath('userData'))
  const logger = new DiagnosticLogger(app.getPath('userData'))
  diagnosticLogger = logger
  await logger.log('info', 'application-initializing', { appVersion: app.getVersion(), platform: process.platform, arch: process.arch, proxySource: proxy.source })
  const versions = new VersionManager(app.getPath('userData'), path.join(resourcesRoot, 'dsh'), runtime, proxy.url)
  const applyProxyPreferences = async (mode: ProxyMode, manualProxyUrl: string | null): Promise<void> => {
    const resolution = mode === 'manual' ? { source: 'manual' as const, url: proxyUrlSchema.parse(manualProxyUrl) } : proxy
    await applyNetworkProxy(session.defaultSession, resolution)
    versions.setProxyUrl(resolution.url)
  }
  const externalInstallations = new ExternalInstallationManager(runtime)
  let backupManager: BackupManager | null = null
  let harnessHome: string | null = null
  try {
    harnessHome = resolveHarnessHome(process.env, os.homedir())
    backupManager = new BackupManager(app.getPath('userData'), harnessHome)
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'Harness 备份功能初始化失败')
  }
  const runtimePathEntries = [runtime.commandDir, path.dirname(runtime.node)]
  const supervisor = new DshSupervisor(runtime.node, runtimePathEntries)
  const quarantine = new PluginQuarantineStore(app.getPath('userData'))
  const repairEngine = harnessHome && backupManager
    ? new RepairEngine({
        supervisor,
        preflight: new DshPreflight(runtime.node, runtimePathEntries, path.join(app.getPath('userData'), 'repair')),
        baselines: new RepairBaselineStore(app.getPath('userData'), harnessHome),
        quarantine,
        transactions: new RepairTransactionStore(app.getPath('userData')),
        backups: backupManager
      })
    : null
  const currentAppVersion = app.getVersion()
  controller = new AppController(
    currentAppVersion, store, new DshRegistry(net.fetch as typeof fetch), versions, supervisor, runtime,
    normalizeSystemLocale(app.getLocale()), undefined, backupManager, externalInstallations, applyProxyPreferences, repairEngine
  )
  controller.on('snapshot', (snapshot: AppSnapshot) => {
    latestSnapshotForWindowTitle = snapshot
    const diagnosticSignature = `${snapshot.runtimeStatus}:${snapshot.selectedVersion}:${snapshot.selectedExternalId}:${snapshot.error ?? ''}`
    if (diagnosticSignature !== lastDiagnosticSignature) {
      lastDiagnosticSignature = diagnosticSignature
      void diagnosticLogger?.log(snapshot.error ? 'error' : 'info', 'harness-state', {
        runtimeStatus: snapshot.runtimeStatus,
        selectedVersion: snapshot.selectedVersion,
        external: snapshot.selectedExternalId !== null,
        error: snapshot.error
      })
    }
    applyDesktopPreferences(snapshot)
    refreshTray(snapshot)
    if (snapshot.locale !== activeLocale || snapshot.localePreference !== activeLocalePreference) {
      activeLocale = snapshot.locale
      activeLocalePreference = snapshot.localePreference
      refreshApplicationChrome()
    }
    setDshWindowTitle(snapshot)
    if (dshWindow && !dshWindow.isDestroyed()) dshUpdatePopover.show(dshWindow, snapshot)
    sendToManager(channels.stateChanged, snapshot)
    updateMenuDshUpdateHint(snapshot)
    // A user close hides the still-running Harness in the tray. Once its
    // runtime stops, destroy the page so a later launch cannot reveal a stale
    // URL whose loopback server no longer exists.
    if (['idle', 'failed'].includes(snapshot.runtimeStatus) && dshWindow && !dshWindow.isDestroyed()) dshWindow.destroy()
  })
  controller.on('progress', (progress: InstallProgress) => {
    void diagnosticLogger?.log(progress.phase === 'failed' ? 'error' : 'info', 'install-progress', progress as unknown as Record<string, unknown>)
    sendToManager(channels.installProgress, progress)
  })
  registerIpc(
    controller,
    (event) => {
      if (!managerWindow || event.sender.id !== managerWindow.webContents.id) throw new Error('拒绝未知窗口调用')
    },
    openDshWindow,
    logger
  )
  const initialSnapshot = await controller.initialize()
  await applyProxyPreferences(initialSnapshot.proxyMode, initialSnapshot.manualProxyUrl)
  applyDesktopPreferences(initialSnapshot)
  activeLocale = initialSnapshot.locale
  activeLocalePreference = initialSnapshot.localePreference
  refreshApplicationChrome()
  ensureTray()
  const refreshed = await controller.refresh()
  latestSnapshotForWindowTitle = refreshed
  notifyDshUpdate(refreshed)
  await openPrimaryWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openPrimaryWindow()
  })
}).catch((error) => {
  console.error(error instanceof Error ? error.message : 'DSH Desktop 初始化失败')
  app.quit()
})

app.on('before-quit', (event) => {
  if (isQuitting) return
  if (controller?.isRuntimeActive()) {
    event.preventDefault()
    quitApplication()
    return
  }
  // Let application-menu and OS-session quits close tray-managed
  // windows instead of being cancelled by their close-to-tray handlers.
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (!closeToTrayEnabled) app.quit()
})
