import { app, Menu, nativeImage, Tray } from 'electron'
import type { AppLocale, AppSnapshot, LocalePreference } from '../shared/contracts'
import { mainCopy } from './copy'

export interface DesktopChromeActions {
  openHarness(): void
  openManager(): void
  stopHarness(): void
  quit(): void
  setLocale(preference: LocalePreference): void
}

function iconPath(): string {
  return app.isPackaged
    ? `${process.resourcesPath}\\ui\\version-manager.png`
    : `${app.getAppPath()}\\build\\menu-version-manager.png`
}

export function createTray(actions: DesktopChromeActions): Tray {
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 })
  const tray = new Tray(icon)
  tray.setToolTip('DSH Desktop')
  tray.on('double-click', actions.openHarness)
  return tray
}

export function updateTrayMenu(
  tray: Tray,
  snapshot: AppSnapshot | null,
  fallbackLocale: AppLocale,
  enabled: boolean,
  actions: DesktopChromeActions
): void {
  const copy = mainCopy(snapshot?.locale ?? fallbackLocale)
  const running = snapshot?.runtimeStatus === 'running' || snapshot?.runtimeStatus === 'starting'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: copy.openHarness, enabled, click: actions.openHarness },
    { label: copy.openManager, enabled, click: actions.openManager },
    { type: 'separator' },
    running
      ? { label: copy.stopHarness, click: actions.stopHarness }
      : { label: copy.startHarness, enabled: Boolean(snapshot?.selectedVersion), click: actions.openHarness },
    { type: 'separator' },
    { label: copy.quit, click: actions.quit }
  ]))
}

export function installApplicationMenu(locale: AppLocale, enabled: boolean, actions: DesktopChromeActions): void {
  const copy = mainCopy(locale)
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 })
  const languageMenu: Electron.MenuItemConstructorOptions = {
    label: copy.language,
    submenu: [
      { label: '简体中文', type: 'radio', checked: locale === 'zh-CN', click: () => actions.setLocale('zh-CN') },
      { label: 'English', type: 'radio', checked: locale === 'en-US', click: () => actions.setLocale('en-US') }
    ]
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'DSH Desktop',
      submenu: [
        { id: 'about-dsh-desktop', label: copy.about, click: () => app.showAboutPanel() },
        { type: 'separator' },
        { id: 'quick-update-dsh', label: copy.versionManager, enabled: false, click: actions.openManager },
        { id: 'version-manager', label: copy.versionManager, icon: icon.isEmpty() ? undefined : icon, accelerator: 'CmdOrCtrl+,', enabled, click: actions.openManager },
        languageMenu,
        { type: 'separator' },
        { role: 'quit', label: copy.quit }
      ]
    },
    { label: copy.edit, submenu: [{ role: 'undo', label: copy.undo }, { role: 'redo', label: copy.redo }, { type: 'separator' }, { role: 'cut', label: copy.cut }, { role: 'copy', label: copy.copy }, { role: 'paste', label: copy.paste }, { role: 'selectAll', label: copy.selectAll }] },
    { label: copy.window, submenu: [{ role: 'minimize', label: copy.minimize }, { role: 'zoom', label: copy.zoom }] }
  ]))
}

export function updateAboutPanel(locale: AppLocale): void {
  const copy = mainCopy(locale)
  app.setAboutPanelOptions({
    applicationName: 'DSH Desktop',
    applicationVersion: app.getVersion(),
    version: copy.version(app.getVersion()),
    copyright: 'Copyright © 2026 DSH Desktop contributors',
    credits: copy.credits
  })
}
