import type { AppLocale } from '../shared/contracts'

export function localizeMessage(locale: AppLocale, message: string): string {
  if (locale === 'zh-CN') return message
  const exact: Record<string, string> = {
    '正在读取本机状态…': 'Reading local state…', '准备就绪': 'Ready', '操作完成': 'Completed', '操作失败': 'Operation failed',
    '内置 Node.js 运行环境不可用': 'The bundled Node.js runtime is unavailable', '检查版本失败': 'Could not check versions',
    '已有 DSH 版本正在安装': 'Another DSH version is already being installed', '已有 DSH 版本操作正在进行': 'Another DSH version operation is in progress', '安装失败': 'Installation failed', '卸载失败': 'Uninstallation failed',
    '该版本不是用户安装的 DSH 版本': 'This DSH version was not installed by the user', '无法卸载当前使用的 DSH 版本，请先切换到其他版本': 'Switch to another DSH version before uninstalling the current version',
    '请先停止正在运行的 DSH': 'Stop the running DSH instance first', '请先安装并选择一个 DSH 版本': 'Install and select a DSH version first',
    '启动失败': 'Could not start DSH', '无法查询官方 DSH 版本': 'Could not query official DSH versions',
    'npm registry 未返回有效版本': 'The npm registry did not return any valid versions',
    '该版本不在官方 npm 版本目录中': 'This version is not listed in the official npm catalog',
    '正在校验官方包版本和入口': 'Validating the official package version and entry point',
    '官方 DSH 包身份或版本校验失败': 'Official DSH package identity or version validation failed',
    '官方 DSH 包未提供 dsh CLI 入口': 'The official DSH package does not provide a dsh CLI entry point',
    '官方 DSH CLI 入口无效': 'The official DSH CLI entry point is invalid',
    '命令执行超时': 'Command timed out', 'DSH 已经在运行': 'DSH is already running',
    '官方 DSH 在规定时间内未返回本地访问地址': 'Official DSH did not provide a local URL in time',
    '无法启动官方 DSH 进程': 'Could not start the official DSH process'
  }
  if (exact[message]) return exact[message]
  return message
    .replace(/^正在安装官方 DSH (.+)$/, 'Installing official DSH $1')
    .replace(/^DSH (.+) 已安装$/, 'DSH $1 installed')
    .replace(/^正在获取依赖：已解析 (\d+)，已复用 (\d+)，已下载 (\d+)，已安装 (\d+)$/, 'Fetching dependencies: $1 resolved, $2 reused, $3 downloaded, $4 installed')
    .replace(/^检查更新失败：/, 'Update check failed: ')
    .replace(/^官方 DSH 在规定时间内未返回本地访问地址：/, 'Official DSH did not provide a local URL in time: ')
    .replace(/^官方 DSH 启动失败（退出码 (.+?)）：/, 'Official DSH failed to start (exit code $1): ')
    .replace(/^官方 DSH 启动失败（退出码 (.+)）$/, 'Official DSH failed to start (exit code $1)')
    .replace(/^pnpm 安装失败（退出码 (.+)）：/, 'pnpm installation failed (exit code $1): ')
    .replace(/^pnpm 安装超过 (.+) 分钟无进展$/, 'pnpm installation made no progress for $1 minutes')
}

export function copy(locale: AppLocale) {
  if (locale === 'en-US') return {
    readingState: 'Reading local state…', ready: 'Ready', completed: 'Completed', failed: 'Operation failed',
    versionManager: 'Version Manager', communityClient: 'DeepSeek Harness community desktop client', switchToEnglish: 'Switch to English', switchToChinese: '切换为中文',
    currentDshVersion: 'Current DSH version', currentlyUsing: 'Currently using', dshNotInstalled: 'DSH is not installed', current: 'Current', bundled: 'Bundled', updateAvailable: 'Update available',
    quickUpdateAction: (version: string) => `Update to v${version}`, quickSwitching: (version: string) => `Switching to v${version}…`, quickInstalling: (version: string) => `Installing and switching to v${version}…`, quickUpdateTooltip: (version: string) => `A new DeepSeek Harness ${version} is available. Click to install and switch with backup and rollback protection.`, quickUpdateBusy: 'Checking DSH update',
    officialFeaturesUnchanged: 'Launched by DSH Desktop. Official features and data remain unchanged.', stop: 'Stop', openDsh: 'Open DSH', startDsh: 'Start DSH', stoppingDsh: 'Stopping DSH…', openingDsh: 'Opening DSH…', startingDsh: 'Starting DSH…',
    versionFilters: 'Version filters', versions: 'Versions', allVersions: 'All versions', installed: 'Installed', available: 'Available', installedVersions: 'Installed versions', availableVersions: 'Available versions',
    versionSource: 'Version source', officialNpm: 'Official npm registry', officialNpmShort: 'Official npm', onlyOfficialLine1: 'Installs and runs only', onlyOfficialLine2: 'official DSH packages',
    registryAddress: 'Registry address', save: 'Save', releaseChannel: 'Channel', stable: 'Stable', preview: 'Preview', allChannels: 'All', savingVersionPreferences: 'Saving version source settings…',
    backups: 'Backups', backupUnavailable: 'Backup unavailable', backupConfig: 'Back up config', backupAll: 'Back up all', configOnly: 'Config', configAndSessions: 'Config + sessions', restoreConfig: 'Restore config', restoreAll: 'Restore all', creatingBackup: 'Creating backup…', restoringBackup: 'Restoring backup…', confirmRestore: 'Stop Harness and restore this backup? A safety backup of the current data will be created first.', confirmUninstall: (version: string) => `Uninstall Harness ${version}?`,
    existingInstallations: 'Existing installations', rescan: 'Rescan this computer', scanningInstallations: 'Scanning for existing Harness installations…', readOnly: 'Read-only', inPlace: 'In-place', useInPlace: 'Use', noExistingInstallations: 'No verified existing installations found.',
    desktopPreferences: 'Desktop', closeToTray: 'Close to tray', startAtLogin: 'Start at login', savingDesktopPreferences: 'Saving desktop preferences…',
    networkProxy: 'Network proxy', systemProxy: 'System / auto', manualProxy: 'Manual', manualProxyAddress: 'Manual proxy address', saveNetwork: 'Apply network', savingNetworkPreferences: 'Applying network proxy…',
    openDiagnostics: 'Open diagnostic logs', repairMode: 'Startup repair', repairModeAuto: 'Automatic', repairModeAsk: 'Ask first', repairModeDiagnose: 'Diagnose only', repairModeHelp: 'At most one safe repair and one retry per launch.', savingRepairMode: 'Saving startup repair mode…',
    searchVersion: 'Search versions', showPrerelease: 'Show prereleases', refreshVersions: 'Refresh official versions', syncingVersions: 'Syncing official npm versions…',
    versionCount: (count: number) => `${count} version${count === 1 ? '' : 's'}`, latest: 'Latest', inUse: 'In use', switching: 'Switching…', switch: 'Switch', installing: 'Installing…', install: 'Install', uninstalling: 'Uninstalling…', uninstall: 'Uninstall',
    switchingTo: (version: string) => `Switching to ${version}…`, installingVersion: (version: string) => `Installing ${version}…`, uninstallingVersion: (version: string) => `Uninstalling ${version}…`,
    noMatchingVersions: 'No matching versions', refreshEmpty: 'Refresh to load versions from the official npm registry.', adjustFilters: 'Try adjusting the filters or search.', unknown: 'Unknown', unknownPublishDate: 'Publish date unknown',
    notRunning: 'Not running', starting: 'Starting', dshRunning: 'DSH running', stopping: 'Stopping', runtimeError: 'Runtime error',
    dshStartupFailed: 'Official DSH failed to start', dshStartupFailedSummary: 'This version returned an error. Expand details to see the cause.', copyError: 'Copy error', errorCopied: 'Copied', errorCopyFailed: 'Copy failed', viewDetails: 'View details', hideDetails: 'Hide details',
    officialErrorBoundary: 'These startup details came from official DSH. DSH Desktop did not modify your configuration or credentials.',
    startupRepair: 'Startup repair', noRepairNeeded: 'No repair was needed for this launch.', healthCheckPassed: 'Healthy', confidenceLabel: (value: string) => `${value} confidence`, copyRepairReport: 'Copy report', reportCopied: 'Report copied', reportCopyFailed: 'Copy failed',
    repairConfirmationHelp: 'The launcher found one reversible repair. Your configuration is backed up before it runs.', repairNeedsManualHandling: 'This issue is diagnosis-only because it cannot be repaired safely by the launcher.', confirmRepair: 'Repair and retry', confirmingRepair: 'Applying repair and retrying…',
    quarantinedPlugin: 'Quarantined plugin', pluginKeptDisabled: 'This plugin will remain disabled for launcher-managed starts.', choosePluginOutcome: 'Harness recovered. Choose what to do with this plugin.', keepDisabled: 'Keep disabled', keepingPluginDisabled: 'Keeping plugin disabled…', reenablePlugin: 'Re-enable', reenablingPlugin: 'Re-enabling plugin and checking Harness…', uninstallPlugin: 'Uninstall plugin', uninstallingPlugin: 'Uninstalling the conflict plugin…', confirmPluginUninstall: (name: string) => `Uninstall ${name}? A configuration backup will be created first.`,
    repairDetails: 'Diagnosis and action details', repairId: 'Repair ID', repairAttempts: 'Repair rounds', retryAttempts: 'Startup retries'
  }
  return {
    readingState: '正在读取本机状态…', ready: '准备就绪', completed: '操作完成', failed: '操作失败',
    versionManager: '版本管理', communityClient: 'DeepSeek Harness 社区桌面客户端', switchToEnglish: '切换为英文', switchToChinese: '切换为中文',
    currentDshVersion: '当前 DSH 版本', currentlyUsing: '当前使用', dshNotInstalled: '尚未安装 DSH', current: '当前', bundled: '随应用提供', updateAvailable: '可更新',
    quickUpdateAction: (version: string) => `更新到 v${version}`, quickSwitching: (version: string) => `正在切换到 v${version}…`, quickInstalling: (version: string) => `正在安装并切换到 v${version}…`, quickUpdateTooltip: (version: string) => `发现 DeepSeek Harness ${version}，点击安装并切换，全程受备份和回滚保护。`, quickUpdateBusy: '正在检查 DSH 更新',
    officialFeaturesUnchanged: '由 DSH Desktop 启动，官方功能和数据保持原样。', stop: '停止', openDsh: '打开 DSH', startDsh: '启动 DSH', stoppingDsh: '正在停止 DSH…', openingDsh: '正在打开 DSH…', startingDsh: '正在启动 DSH…',
    versionFilters: '版本筛选', versions: '版本', allVersions: '全部版本', installed: '已安装', available: '可安装', installedVersions: '已安装版本', availableVersions: '可安装版本',
    versionSource: '版本来源', officialNpm: 'npm 官方源', officialNpmShort: '官方 npm', onlyOfficialLine1: '仅安装并运行', onlyOfficialLine2: '官方 DSH 包',
    registryAddress: '镜像地址', save: '保存', releaseChannel: '渠道', stable: '稳定版', preview: '预览版', allChannels: '全部', savingVersionPreferences: '正在保存版本源设置…',
    backups: '备份', backupUnavailable: '备份不可用', backupConfig: '备份配置', backupAll: '完整备份', configOnly: '仅配置', configAndSessions: '配置及会话', restoreConfig: '恢复配置', restoreAll: '全部恢复', creatingBackup: '正在创建备份…', restoringBackup: '正在恢复备份…', confirmRestore: '确定停止 Harness 并恢复这个备份吗？恢复前会先为当前数据创建安全备份。', confirmUninstall: (version: string) => `确定卸载 Harness ${version} 吗？`,
    existingInstallations: '本机既有安装', rescan: '重新扫描本机', scanningInstallations: '正在扫描本机 Harness 安装…', readOnly: '只读', inPlace: '原地管理', useInPlace: '使用', noExistingInstallations: '未发现已验证的既有安装。',
    desktopPreferences: '桌面设置', closeToTray: '关闭到托盘', startAtLogin: '开机启动', savingDesktopPreferences: '正在保存桌面设置…',
    networkProxy: '网络代理', systemProxy: '系统/自动', manualProxy: '手动', manualProxyAddress: '手动代理地址', saveNetwork: '应用网络设置', savingNetworkPreferences: '正在应用网络代理…',
    openDiagnostics: '打开诊断日志', repairMode: '启动修复', repairModeAuto: '自动修复', repairModeAsk: '修复前询问', repairModeDiagnose: '仅诊断', repairModeHelp: '每次启动最多执行一轮安全修复和一次重试。', savingRepairMode: '正在保存启动修复模式…',
    searchVersion: '搜索版本号', showPrerelease: '显示预发布版本', refreshVersions: '刷新官方版本', syncingVersions: '正在同步 npm 官方版本…',
    versionCount: (count: number) => `${count} 个版本`, latest: '最新', inUse: '使用中', switching: '切换中…', switch: '切换', installing: '安装中…', install: '安装', uninstalling: '卸载中…', uninstall: '卸载',
    switchingTo: (version: string) => `正在切换到 ${version}…`, installingVersion: (version: string) => `正在安装 ${version}…`, uninstallingVersion: (version: string) => `正在卸载 ${version}…`,
    noMatchingVersions: '没有符合条件的版本', refreshEmpty: '点击右上角刷新，从 npm 官方源获取版本。', adjustFilters: '试试调整筛选或搜索内容。', unknown: '未知', unknownPublishDate: '发布时间未知',
    notRunning: '未运行', starting: '启动中', dshRunning: 'DSH 运行中', stopping: '停止中', runtimeError: '运行异常',
    dshStartupFailed: '官方 DSH 启动失败', dshStartupFailedSummary: '当前版本返回了错误，展开详情可查看具体原因。', copyError: '复制错误', errorCopied: '已复制', errorCopyFailed: '复制失败', viewDetails: '查看详情', hideDetails: '收起详情',
    officialErrorBoundary: '以上为官方 DSH 的启动失败详情，DSH Desktop 未修改你的配置或凭据。',
    startupRepair: '启动修复', noRepairNeeded: '本次启动无需修复。', healthCheckPassed: '检查通过', confidenceLabel: (value: string) => `${value === 'high' ? '高' : value === 'medium' ? '中' : '低'}置信度`, copyRepairReport: '复制报告', reportCopied: '报告已复制', reportCopyFailed: '复制失败',
    repairConfirmationHelp: '启动器找到了一项可回滚修复，执行前会先备份配置。', repairNeedsManualHandling: '此问题无法由启动器安全修复，当前仅提供诊断。', confirmRepair: '修复并重试', confirmingRepair: '正在修复并重试…',
    quarantinedPlugin: '已隔离插件', pluginKeptDisabled: '以后由启动器管理的启动将继续禁用此插件。', choosePluginOutcome: 'Harness 已恢复，请决定如何处理这个插件。', keepDisabled: '保持禁用', keepingPluginDisabled: '正在保持插件禁用…', reenablePlugin: '重新启用', reenablingPlugin: '正在重新启用插件并检查 Harness…', uninstallPlugin: '卸载插件', uninstallingPlugin: '正在卸载冲突插件…', confirmPluginUninstall: (name: string) => `确定卸载 ${name} 吗？卸载前会先创建配置备份。`,
    repairDetails: '诊断与操作详情', repairId: '修复编号', repairAttempts: '修复轮数', retryAttempts: '启动重试'
  }
}
