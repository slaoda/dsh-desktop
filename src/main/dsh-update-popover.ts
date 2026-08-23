import { BrowserWindow } from 'electron'
import semver from 'semver'
import type { AppSnapshot } from '../shared/contracts'
import { mainCopy } from './copy'

export function hasDshUpdate(snapshot: AppSnapshot): snapshot is AppSnapshot & { latestVersion: string } {
  return !!(snapshot.selectedVersion && snapshot.latestVersion && semver.gt(snapshot.latestVersion, snapshot.selectedVersion))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

export class DshUpdatePopover {
  private window: BrowserWindow | null = null
  private dismissedVersion: string | null = null
  private signature: string | null = null

  constructor(private readonly openManager: () => void) {}

  show(parent: BrowserWindow, snapshot: AppSnapshot): void {
    if (parent.isDestroyed() || !hasDshUpdate(snapshot) || this.dismissedVersion === snapshot.latestVersion) {
      this.hide()
      return
    }
    const signature = `${snapshot.locale}:${snapshot.latestVersion}:${snapshot.selectedVersion}`
    if (this.window && !this.window.isDestroyed() && this.signature === signature) {
      this.position(parent)
      this.window.showInactive()
      return
    }
    this.close()
    const copy = mainCopy(snapshot.locale)
    const title = escapeHtml(copy.dshWindowUpdateTag(snapshot.latestVersion))
    const action = escapeHtml(copy.dshPopoverUpdateAction)
    const window = new BrowserWindow({
      parent,
      width: 282,
      height: 76,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      transparent: true,
      hasShadow: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    this.window = window
    this.signature = signature
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.signature = null
      }
    })
    window.webContents.on('will-navigate', (event, rawUrl) => {
      let actionName = ''
      try { actionName = new URL(rawUrl).hostname } catch { return }
      if (!['open-update', 'dismiss-update'].includes(actionName)) return
      event.preventDefault()
      this.hide()
      if (actionName === 'dismiss-update') this.dismissedVersion = snapshot.latestVersion
      else this.openManager()
    })
    window.once('ready-to-show', () => {
      this.position(parent)
      window.showInactive()
    })
    const html = `<!doctype html><html lang="${snapshot.locale === 'zh-CN' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{padding:8px}.card{box-sizing:border-box;height:60px;border:1px solid #d9dde3;border-radius:10px;background:#fff;box-shadow:0 6px 18px rgba(20,28,38,.12);color:#20242b;padding:0 43px 0 14px;display:flex;align-items:center;gap:10px;position:relative}.dot{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:#3b82f6}.title{font-size:13px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.action{flex:0 0 auto;border-radius:6px;background:#2563eb;color:#fff;padding:5px 9px;font-size:12px;font-weight:650;line-height:16px;text-decoration:none}.action:hover{background:#1d4ed8}.close{position:absolute;right:10px;top:18px;width:18px;height:18px;border-radius:5px;color:#8b949e;text-align:center;line-height:16px;font-size:18px;text-decoration:none}.close:hover{background:#f1f3f5;color:#30363d}</style></head><body><div class="card"><span class="dot"></span><div class="title">${title}</div><a class="action" href="dsh-update://open-update">${action}</a><a class="close" href="dsh-update://dismiss-update" aria-label="Close">×</a></div></body></html>`
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  }

  position(parent: BrowserWindow): void {
    if (parent.isDestroyed() || !this.window || this.window.isDestroyed()) return
    const bounds = parent.getBounds()
    const [width] = this.window.getSize()
    this.window.setPosition(bounds.x + bounds.width - width - 18, bounds.y + 72)
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) this.window.hide()
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close()
  }
}
