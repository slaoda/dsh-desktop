import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/ipc-channels'
import type { AppSnapshot, AppUpdateSnapshot, BackupScope, DesktopApi, InstallProgress, LocalePreference, ReleaseChannel } from '../shared/contracts'

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke(channels.snapshot),
  refresh: () => ipcRenderer.invoke(channels.refresh),
  install: (version) => ipcRenderer.invoke(channels.install, version),
  uninstall: (version) => ipcRenderer.invoke(channels.uninstall, version),
  select: (version) => ipcRenderer.invoke(channels.select, version),
  launch: () => ipcRenderer.invoke(channels.launch),
  stop: () => ipcRenderer.invoke(channels.stop),
  dismissUpdate: (version) => ipcRenderer.invoke(channels.dismissUpdate, version),
  openExternal: (url) => ipcRenderer.invoke(channels.openExternal, url),
  copyText: (text) => ipcRenderer.invoke(channels.copyText, text),
  setLocale: (preference: LocalePreference) => ipcRenderer.invoke(channels.setLocale, preference),
  setVersionPreferences: (channel: ReleaseChannel, registryUrl: string) => ipcRenderer.invoke(channels.setVersionPreferences, channel, registryUrl),
  createBackup: (scope: BackupScope) => ipcRenderer.invoke(channels.createBackup, scope),
  restoreBackup: (id: string, scope: BackupScope) => ipcRenderer.invoke(channels.restoreBackup, id, scope),
  refreshExternalInstallations: () => ipcRenderer.invoke(channels.refreshExternalInstallations),
  selectExternalInstallation: (id: string) => ipcRenderer.invoke(channels.selectExternalInstallation, id),
  uninstallExternalInstallation: (id: string) => ipcRenderer.invoke(channels.uninstallExternalInstallation, id),
  getAppUpdate: () => ipcRenderer.invoke(channels.appUpdateSnapshot),
  checkAppUpdate: () => ipcRenderer.invoke(channels.appUpdateCheck),
  downloadAppUpdate: () => ipcRenderer.invoke(channels.appUpdateDownload),
  installAppUpdate: () => ipcRenderer.invoke(channels.appUpdateInstall),
  onStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => listener(snapshot)
    ipcRenderer.on(channels.stateChanged, handler)
    return () => ipcRenderer.removeListener(channels.stateChanged, handler)
  },
  onInstallProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: InstallProgress): void => listener(progress)
    ipcRenderer.on(channels.installProgress, handler)
    return () => ipcRenderer.removeListener(channels.installProgress, handler)
  },
  onAppUpdateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppUpdateSnapshot): void => listener(snapshot)
    ipcRenderer.on(channels.appUpdateChanged, handler)
    return () => ipcRenderer.removeListener(channels.appUpdateChanged, handler)
  }
}

contextBridge.exposeInMainWorld('dshDesktop', api)
