import type { AppLocale } from '../shared/contracts'

export function normalizeSystemLocale(locale: string): AppLocale {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function mainCopy(locale: AppLocale) {
  if (locale === 'en-US') return {
    versionManager: 'Version Manager…', about: 'About DSH Desktop',
    language: 'Language', edit: 'Edit', window: 'Window', hide: 'Hide DSH Desktop', hideOthers: 'Hide Others', quit: 'Quit DSH Desktop',
    undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All', minimize: 'Minimize', zoom: 'Zoom',
    version: (version: string) => `Version ${version}`,
    credits: 'DeepSeek Harness community desktop client',
    dshUpdateTitle: (version: string) => `DSH ${version} is available`,
    dshUpdateBody: (version: string) => `You are still using ${version}. Click to open Version Manager.`,
    dshWindowUpdateTag: (version: string) => `Update Available: v${version}`,
    openDshUpdateManager: (version: string) => `Update to v${version}`,
    dshPopoverUpdateAction: 'Update',
    openHarness: 'Open Harness', openManager: 'Open Manager', startHarness: 'Start Harness', stopHarness: 'Stop Harness'
  }
  return {
    versionManager: '版本管理…', about: '关于 DSH Desktop',
    language: '语言', edit: '编辑', window: '窗口', hide: '隐藏 DSH Desktop', hideOthers: '隐藏其他应用', quit: '退出 DSH Desktop',
    undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选', minimize: '最小化', zoom: '缩放',
    version: (version: string) => `版本 ${version}`,
    credits: 'DeepSeek Harness 社区桌面客户端',
    dshUpdateTitle: (version: string) => `DSH ${version} 可以安装`,
    dshUpdateBody: (version: string) => `当前继续使用 ${version}。点击打开版本管理。`,
    dshWindowUpdateTag: (version: string) => `发现更新: v${version}`,
    openDshUpdateManager: (version: string) => `更新到 v${version}`,
    dshPopoverUpdateAction: '更新',
    openHarness: '打开 Harness', openManager: '打开管理器', startHarness: '启动 Harness', stopHarness: '停止 Harness'
  }
}
