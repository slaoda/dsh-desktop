import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import semver from 'semver'
import type { AppLocale, AppSnapshot, BackupScope, InstallProgress, LocalePreference, ProxyMode, ReleaseChannel } from '../shared/contracts'
import deepSeekWhale from './deepseek-whale.svg'
import { dshRuntimeFailureDetail, isDshRuntimeFailure } from './runtime-error'
import './style.css'

const initialLocale: AppLocale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
const empty: AppSnapshot = {
  appVersion: '0.1.0', nodeVersion: null, latestVersion: null, selectedVersion: null,
  locale: initialLocale, localePreference: 'system', releaseChannel: 'all', registryUrl: 'https://registry.npmjs.org',
  harnessHome: null, backups: [], externalInstallations: [], selectedExternalId: null,
  closeToTray: true, startAtLogin: false, proxyMode: 'system', manualProxyUrl: null,
  dismissedLatest: null, installedVersions: [], availableVersions: [], runtimeStatus: 'idle', runtimeUrl: null, error: null
}
type VersionFilter = 'all' | 'installed' | 'available'
interface VersionRow { version: string; publishedAt: string | null; source: 'bundled' | 'installed' | null; installed: boolean }

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(empty)
  const [filter, setFilter] = useState<VersionFilter>('all')
  const [query, setQuery] = useState('')
  const [showPrerelease, setShowPrerelease] = useState(true)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>('initializing')
  const [message, setMessage] = useState(copy(initialLocale).readingState)
  const [errorDetailsExpanded, setErrorDetailsExpanded] = useState(false)
  const [errorCopyState, setErrorCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [registryDraft, setRegistryDraft] = useState(empty.registryUrl)
  const [proxyModeDraft, setProxyModeDraft] = useState<ProxyMode>(empty.proxyMode)
  const [proxyUrlDraft, setProxyUrlDraft] = useState('')
  const language = copy(snapshot.locale)

  useEffect(() => {
    void window.dshDesktop.getSnapshot().then((value) => { setSnapshot(value); setRegistryDraft(value.registryUrl); setProxyModeDraft(value.proxyMode); setProxyUrlDraft(value.manualProxyUrl ?? ''); document.documentElement.lang = value.locale; setMessage(copy(value.locale).ready); setBusyAction(null) })
    const removeState = window.dshDesktop.onStateChanged(setSnapshot)
    const removeProgress = window.dshDesktop.onInstallProgress((value) => { setProgress(value); setMessage(value.message) })
    return () => { removeState(); removeProgress() }
  }, [])

  useEffect(() => { setRegistryDraft(snapshot.registryUrl) }, [snapshot.registryUrl])
  useEffect(() => { setProxyModeDraft(snapshot.proxyMode); setProxyUrlDraft(snapshot.manualProxyUrl ?? '') }, [snapshot.proxyMode, snapshot.manualProxyUrl])

  useEffect(() => {
    setErrorDetailsExpanded(false)
    setErrorCopyState('idle')
  }, [snapshot.error])

  const rows = useMemo<VersionRow[]>(() => {
    const items = new Map<string, VersionRow>()
    for (const item of snapshot.availableVersions) items.set(item.version, { version: item.version, publishedAt: item.publishedAt, source: null, installed: false })
    for (const item of snapshot.installedVersions) {
      const existing = items.get(item.version)
      items.set(item.version, { version: item.version, publishedAt: existing?.publishedAt ?? null, source: item.source, installed: true })
    }
    return [...items.values()].sort((a, b) => semver.rcompare(a.version, b.version))
  }, [snapshot.availableVersions, snapshot.installedVersions])

  const counts = useMemo(() => ({
    all: rows.length,
    installed: rows.filter((item) => item.installed).length,
    available: rows.filter((item) => !item.installed).length
  }), [rows])

  const visibleRows = useMemo(() => rows.filter((item) => {
    if (filter === 'installed' && !item.installed) return false
    if (filter === 'available' && item.installed) return false
    if (!showPrerelease && semver.prerelease(item.version)) return false
    return item.version.toLowerCase().includes(query.trim().toLowerCase())
  }), [filter, query, rows, showPrerelease])

  const perform = async (key: string, label: string, action: () => Promise<AppSnapshot>): Promise<void> => {
    setBusyAction(key); setMessage(label)
    try { setSnapshot(await action()); setMessage(language.completed) }
    catch (error) { setMessage(localizeMessage(snapshot.locale, error instanceof Error ? error.message : language.failed)) }
    finally { setBusyAction(null) }
  }

  const running = snapshot.runtimeStatus === 'running' || snapshot.runtimeStatus === 'starting'
  const currentInstalled = snapshot.installedVersions.find((item) => item.version === snapshot.selectedVersion)
  const updateAvailable = Boolean(snapshot.latestVersion && snapshot.selectedVersion && semver.gt(snapshot.latestVersion, snapshot.selectedVersion))
  const latestVersion = snapshot.latestVersion
  const canQuickSwitch = Boolean(latestVersion && snapshot.installedVersions.some((item) => item.version === latestVersion))
  const canQuickInstall = Boolean(latestVersion && snapshot.installedVersions.every((item) => item.version !== latestVersion))
  const canQuickUpdate = Boolean(snapshot.latestVersion && snapshot.selectedVersion && semver.lt(snapshot.selectedVersion, snapshot.latestVersion) && (canQuickSwitch || canQuickInstall))
  const quickUpdateKey = latestVersion ? `quick-update-${latestVersion}` : 'quick-update'
  const quickUpdateBusyLabel = latestVersion
    ? (snapshot.installedVersions.some((item) => item.version === latestVersion)
      ? language.quickSwitching(latestVersion)
      : language.quickInstalling(latestVersion))
    : language.quickUpdateBusy
  const quickUpdateTooltip = latestVersion ? language.quickUpdateTooltip(latestVersion) : language.quickUpdateBusy
  const runtimeFailure = isDshRuntimeFailure(snapshot.runtimeStatus, snapshot.error) ? snapshot.error : null
  const runtimeFailureDetail = runtimeFailure ? dshRuntimeFailureDetail(runtimeFailure) : ''
  const localizedRuntimeFailure = runtimeFailure ? localizeMessage(snapshot.locale, runtimeFailure) : ''

  const copyRuntimeError = async (): Promise<void> => {
    if (!runtimeFailure) return
    try {
      await window.dshDesktop.copyText(runtimeFailure)
      setErrorCopyState('copied')
    } catch {
      setErrorCopyState('failed')
    }
  }

  const changeLocale = async (preference: LocalePreference): Promise<void> => {
    const next = await window.dshDesktop.setLocale(preference)
    setSnapshot(next)
    document.documentElement.lang = next.locale
    setMessage(copy(next.locale).ready)
  }

  const changeVersionPreferences = async (channel: ReleaseChannel, registryUrl: string): Promise<void> => {
    await perform('version-preferences', language.savingVersionPreferences, () => window.dshDesktop.setVersionPreferences(channel, registryUrl))
  }

  const quickUpdateHarness = async (): Promise<void> => {
    if (!latestVersion || !snapshot.selectedVersion || !semver.lt(snapshot.selectedVersion, latestVersion)) return
    const isLatestInstalled = snapshot.installedVersions.some((item) => item.version === latestVersion)
    const action = isLatestInstalled
      ? () => window.dshDesktop.select(latestVersion)
      : async () => {
          await window.dshDesktop.install(latestVersion)
          return await window.dshDesktop.select(latestVersion)
        }
    await perform(quickUpdateKey, quickUpdateBusyLabel, action)
  }

  const uninstallVersion = async (version: string): Promise<void> => {
    if (!window.confirm(language.confirmUninstall(version))) return
    await perform(`uninstall:${version}`, language.uninstallingVersion(version), () => window.dshDesktop.uninstall(version))
  }

  const createBackup = async (scope: BackupScope): Promise<void> => {
    await perform(`backup:${scope}`, language.creatingBackup, () => window.dshDesktop.createBackup(scope))
  }

  const restoreBackup = async (id: string, scope: BackupScope): Promise<void> => {
    if (!window.confirm(language.confirmRestore)) return
    await perform(`restore:${id}:${scope}`, language.restoringBackup, () => window.dshDesktop.restoreBackup(id, scope))
  }

  const selectExternalInstallation = async (id: string, version: string): Promise<void> => {
    await perform(`external-select:${id}`, language.switchingTo(version), () => window.dshDesktop.selectExternalInstallation(id))
  }

  const uninstallExternalInstallation = async (id: string, version: string): Promise<void> => {
    if (!window.confirm(language.confirmUninstall(version))) return
    await perform(`external-uninstall:${id}`, language.uninstallingVersion(version), () => window.dshDesktop.uninstallExternalInstallation(id))
  }

  const setDesktopPreferences = async (closeToTray: boolean, startAtLogin: boolean): Promise<void> => {
    await perform('desktop-preferences', language.savingDesktopPreferences, () => window.dshDesktop.setDesktopPreferences(closeToTray, startAtLogin))
  }

  const saveNetworkPreferences = async (): Promise<void> => {
    await perform('network-preferences', language.savingNetworkPreferences, () => window.dshDesktop.setNetworkPreferences(proxyModeDraft, proxyModeDraft === 'manual' ? proxyUrlDraft : null))
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true"><img src={deepSeekWhale} alt="" /></div>
      <div className="brand-copy">
        <h1>
          {language.versionManager}
        </h1>
        <p>{language.communityClient}</p>
      </div>
      <button
        type="button"
        className="language-switch"
        aria-label={snapshot.locale === 'zh-CN' ? language.switchToEnglish : language.switchToChinese}
        title={snapshot.locale === 'zh-CN' ? language.switchToEnglish : language.switchToChinese}
        onClick={() => void changeLocale(snapshot.locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
      >
        {snapshot.locale === 'zh-CN' ? 'English' : '中文'}
      </button>
      <div className="desktop-version">
        <strong>v{snapshot.appVersion}</strong>
      </div>
    </header>

    <section className="current-card" aria-label={language.currentDshVersion}>
      <div className="current-summary">
        <div className="current-orbit" aria-hidden="true"><img src={deepSeekWhale} alt="" /></div>
        <div className="current-copy">
          <span className="overline">{language.currentlyUsing}</span>
          <div className="current-title">
            <h2>{snapshot.selectedVersion ? `DSH ${snapshot.selectedVersion}` : language.dshNotInstalled}</h2>
            {snapshot.selectedVersion && <span className="tag tag-current">{language.current}</span>}
            {currentInstalled?.source === 'bundled' && <span className="tag">{language.bundled}</span>}
            {updateAvailable && <span className="tag tag-update">{language.updateAvailable}</span>}
            {canQuickUpdate && (
              <button
                type="button"
                className="harness-update-action"
                aria-label={language.quickUpdateAction(latestVersion ?? '')}
                title={quickUpdateTooltip}
                onClick={() => void quickUpdateHarness()}
                disabled={busyAction !== null}
              >
                {language.quickUpdateAction(latestVersion ?? '')}
              </button>
            )}
          </div>
          <p>{language.officialFeaturesUnchanged}</p>
        </div>
        <div className="current-actions">
          <span className={`runtime-pill runtime-${snapshot.runtimeStatus}`}><i />{statusText(snapshot.runtimeStatus, snapshot.locale)}</span>
          {running && <button className="button secondary" disabled={busyAction !== null} onClick={() => void perform('stop', language.stoppingDsh, window.dshDesktop.stop)}>{language.stop}</button>}
          <button className="button primary" disabled={busyAction !== null || !snapshot.selectedVersion} onClick={() => void perform('launch', running ? language.openingDsh : language.startingDsh, window.dshDesktop.launch)}>
            <OpenIcon />{running ? language.openDsh : language.startDsh}
          </button>
        </div>
      </div>
      {runtimeFailure && <section className="runtime-error-panel" role="alert" aria-live="assertive">
        <div className="runtime-error-icon" aria-hidden="true">!</div>
        <div className="runtime-error-content">
          <div className="runtime-error-heading">
            <div>
              <strong>{language.dshStartupFailed}</strong>
              <p>{language.dshStartupFailedSummary}</p>
            </div>
            <div className="runtime-error-actions">
              <button type="button" className="runtime-error-copy" onClick={() => void copyRuntimeError()}>
                {errorCopyState === 'copied' ? language.errorCopied : errorCopyState === 'failed' ? language.errorCopyFailed : language.copyError}
              </button>
              <button
                type="button"
                className="runtime-error-toggle"
                aria-expanded={errorDetailsExpanded}
                aria-controls="runtime-error-details"
                onClick={() => setErrorDetailsExpanded((current) => !current)}
              >
                {errorDetailsExpanded ? language.hideDetails : language.viewDetails}
              </button>
            </div>
          </div>
          {!errorDetailsExpanded && <p className="runtime-error-preview">{runtimeFailureDetail || localizedRuntimeFailure}</p>}
          {errorDetailsExpanded && <div id="runtime-error-details" className="runtime-error-details">
            <pre>{localizedRuntimeFailure}</pre>
            <p>{language.officialErrorBoundary}</p>
          </div>}
        </div>
      </section>}
    </section>

    <section className="library">
      <aside className="sidebar" aria-label={language.versionFilters}>
        <div className="side-heading">{language.versions}</div>
        <nav>
          <FilterButton active={filter === 'all'} label={language.allVersions} count={counts.all} icon={<GridIcon />} onClick={() => setFilter('all')} />
          <FilterButton active={filter === 'installed'} label={language.installed} count={counts.installed} icon={<CheckIcon />} onClick={() => setFilter('installed')} />
          <FilterButton active={filter === 'available'} label={language.available} count={counts.available} icon={<DownloadIcon />} onClick={() => setFilter('available')} />
        </nav>
        <div className="source-block">
          <span className="side-heading">{language.versionSource}</span>
          <div className="source-row"><NpmIcon /><span><strong>{language.officialNpm}</strong><small>@deepseek-ai/dsh</small></span></div>
          <label className="registry-settings">
            <span>{language.registryAddress}</span>
            <input value={registryDraft} onChange={(event) => setRegistryDraft(event.target.value)} aria-label={language.registryAddress} />
            <button type="button" disabled={busyAction !== null || registryDraft === snapshot.registryUrl} onClick={() => void changeVersionPreferences(snapshot.releaseChannel, registryDraft)}>{language.save}</button>
          </label>
        </div>
        <div className="boundary-note"><ShieldIcon /><span>{language.onlyOfficialLine1}<br />{language.onlyOfficialLine2}</span></div>
        <section className="backup-panel" aria-label={language.backups}>
          <span className="side-heading">{language.backups}</span>
          <small title={snapshot.harnessHome ?? ''}>{snapshot.harnessHome ?? language.backupUnavailable}</small>
          <div className="backup-actions"><button type="button" disabled={busyAction !== null || running || !snapshot.harnessHome} onClick={() => void createBackup('configuration')}>{language.backupConfig}</button><button type="button" disabled={busyAction !== null || running || !snapshot.harnessHome} onClick={() => void createBackup('full')}>{language.backupAll}</button></div>
          <div className="backup-list">{snapshot.backups.map((backup) => <article key={backup.id}><span>{formatDate(backup.createdAt, snapshot.locale)} · {backup.scope === 'full' ? language.configAndSessions : language.configOnly}</span><div><button type="button" disabled={busyAction !== null || running} onClick={() => void restoreBackup(backup.id, 'configuration')}>{language.restoreConfig}</button>{backup.scope === 'full' && <button type="button" disabled={busyAction !== null || running} onClick={() => void restoreBackup(backup.id, 'full')}>{language.restoreAll}</button>}</div></article>)}</div>
        </section>
        <section className="external-panel" aria-label={language.existingInstallations}>
          <div className="external-heading"><span className="side-heading">{language.existingInstallations}</span><button type="button" title={language.rescan} aria-label={language.rescan} disabled={busyAction !== null} onClick={() => void perform('external-refresh', language.scanningInstallations, window.dshDesktop.refreshExternalInstallations)}><RefreshIcon /></button></div>
          <div className="external-list">{snapshot.externalInstallations.map((item) => <article key={item.id} className={snapshot.selectedExternalId === item.id ? 'is-current' : ''}>
            <strong>Harness {item.version}</strong><span>{externalSourceLabel(item.source, snapshot.locale)} · {item.readOnly ? language.readOnly : language.inPlace}</span><small title={item.packageRoot}>{item.packageRoot}</small>{item.reason && <em>{localizeMessage(snapshot.locale, item.reason)}</em>}
            <div>{!item.readOnly && snapshot.selectedExternalId !== item.id && <button type="button" disabled={busyAction !== null} onClick={() => void selectExternalInstallation(item.id, item.version)}>{language.useInPlace}</button>}{snapshot.selectedExternalId === item.id && <b>{language.inUse}</b>}{item.canUninstall && snapshot.selectedExternalId !== item.id && <button type="button" disabled={busyAction !== null} onClick={() => void uninstallExternalInstallation(item.id, item.version)}>{language.uninstall}</button>}</div>
          </article>)}</div>
          {snapshot.externalInstallations.length === 0 && <small>{language.noExistingInstallations}</small>}
        </section>
        <section className="desktop-preferences" aria-label={language.desktopPreferences}>
          <span className="side-heading">{language.desktopPreferences}</span>
          <label><input type="checkbox" checked={snapshot.closeToTray} disabled={busyAction !== null} onChange={(event) => void setDesktopPreferences(event.target.checked, snapshot.startAtLogin)} />{language.closeToTray}</label>
          <label><input type="checkbox" checked={snapshot.startAtLogin} disabled={busyAction !== null} onChange={(event) => void setDesktopPreferences(snapshot.closeToTray, event.target.checked)} />{language.startAtLogin}</label>
          <label className="network-setting"><span>{language.networkProxy}</span><select value={proxyModeDraft} disabled={busyAction !== null} onChange={(event) => setProxyModeDraft(event.target.value as ProxyMode)}><option value="system">{language.systemProxy}</option><option value="manual">{language.manualProxy}</option></select></label>
          {proxyModeDraft === 'manual' && <input className="proxy-input" value={proxyUrlDraft} disabled={busyAction !== null} onChange={(event) => setProxyUrlDraft(event.target.value)} placeholder="http://127.0.0.1:7890" aria-label={language.manualProxyAddress} />}
          <button type="button" className="network-save" disabled={busyAction !== null || (proxyModeDraft === snapshot.proxyMode && (proxyModeDraft !== 'manual' || proxyUrlDraft === (snapshot.manualProxyUrl ?? '')))} onClick={() => void saveNetworkPreferences()}>{language.saveNetwork}</button>
          <button type="button" className="diagnostics-button" disabled={busyAction !== null} onClick={() => void window.dshDesktop.openDiagnosticsDirectory()}>{language.openDiagnostics}</button>
        </section>
      </aside>

      <div className="version-content">
        <div className="toolbar">
          <label className="search"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language.searchVersion} aria-label={language.searchVersion} /></label>
          <label className="channel-picker"><span>{language.releaseChannel}</span><select value={snapshot.releaseChannel} disabled={busyAction !== null} onChange={(event) => void changeVersionPreferences(event.target.value as ReleaseChannel, snapshot.registryUrl)}><option value="stable">{language.stable}</option><option value="preview">{language.preview}</option><option value="all">{language.allChannels}</option></select></label>
          <label className="toggle-label"><input type="checkbox" checked={showPrerelease} onChange={(event) => setShowPrerelease(event.target.checked)} /><span className="toggle" />{language.showPrerelease}</label>
          <button className="icon-button" title={language.refreshVersions} aria-label={language.refreshVersions} disabled={busyAction !== null} onClick={() => void perform('refresh', language.syncingVersions, window.dshDesktop.refresh)}><RefreshIcon /></button>
        </div>

        <div className="list-heading"><span>{filterLabel(filter, snapshot.locale)}</span><small>{language.versionCount(visibleRows.length)}</small></div>
        <div className="version-list" aria-live="polite">
          {visibleRows.map((item) => {
            const current = snapshot.selectedVersion === item.version
            const actionKey = `${item.installed ? 'switch' : 'install'}:${item.version}`
            return <article className={`version-row ${current ? 'is-current' : ''}`} key={item.version}>
              <div className="version-node" aria-hidden="true"><span /></div>
              <div className="version-info">
                <div className="version-name"><strong>{item.version}</strong>{current && <span className="tag tag-current">{language.current}</span>}{item.installed && <span className="tag">{language.installed}</span>}{snapshot.latestVersion === item.version && <span className="tag tag-latest">{language.latest}</span>}</div>
                <p>{formatDate(item.publishedAt, snapshot.locale)} · {language.officialNpmShort}</p>
              </div>
              {current
                ? <button className="button row-action current-action" disabled><CheckIcon />{language.inUse}</button>
                : item.installed
                  ? <div className="row-actions">
                      <button className="button row-action secondary" disabled={busyAction !== null} onClick={() => void perform(actionKey, language.switchingTo(item.version), () => window.dshDesktop.select(item.version))}>{busyAction === actionKey ? language.switching : language.switch}</button>
                      {item.source === 'installed' && <button className="button row-action uninstall" disabled={busyAction !== null} onClick={() => void uninstallVersion(item.version)}><TrashIcon />{busyAction === `uninstall:${item.version}` ? language.uninstalling : language.uninstall}</button>}
                    </div>
                  : <button className="button row-action install" disabled={busyAction !== null} onClick={() => void perform(actionKey, language.installingVersion(item.version), () => window.dshDesktop.install(item.version))}><DownloadIcon />{busyAction === actionKey ? language.installing : language.install}</button>}
            </article>
          })}
          {visibleRows.length === 0 && <div className="empty-state"><span>⌕</span><strong>{language.noMatchingVersions}</strong><p>{snapshot.availableVersions.length === 0 ? language.refreshEmpty : language.adjustFilters}</p></div>}
        </div>
      </div>
    </section>

    <footer className="footer">
      <span className={snapshot.error && !runtimeFailure ? 'error-message' : ''}>{runtimeFailure ? '' : <>{progress?.phase === 'downloading' && busyAction?.startsWith('install') ? '● ' : ''}{localizeMessage(snapshot.locale, snapshot.error ?? message)}</>}</span>
      <span>Node {snapshot.nodeVersion ?? language.unknown}</span>
    </footer>
  </main>
}

function FilterButton({ active, label, count, icon, onClick }: { active: boolean; label: string; count: number; icon: React.ReactNode; onClick: () => void }): React.JSX.Element {
  return <button className={`filter-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span><b>{count}</b></button>
}
function filterLabel(filter: VersionFilter, locale: AppLocale): string {
  const language = copy(locale)
  return ({ all: language.allVersions, installed: language.installedVersions, available: language.availableVersions })[filter]
}
function formatDate(value: string | null, locale: AppLocale): string {
  if (!value) return copy(locale).unknownPublishDate
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? copy(locale).unknownPublishDate : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}
function statusText(status: AppSnapshot['runtimeStatus'], locale: AppLocale): string {
  const language = copy(locale)
  return ({ idle: language.notRunning, starting: language.starting, running: language.dshRunning, stopping: language.stopping, failed: language.runtimeError })[status]
}
function externalSourceLabel(source: AppSnapshot['externalInstallations'][number]['source'], locale: AppLocale): string {
  const labels = locale === 'zh-CN'
    ? { environment: 'DSH_BIN', 'npm-global': 'npm 全局', path: 'PATH', project: '项目依赖' }
    : { environment: 'DSH_BIN', 'npm-global': 'Global npm', path: 'PATH', project: 'Project dependency' }
  return labels[source]
}
function localizeMessage(locale: AppLocale, message: string): string {
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

function copy(locale: AppLocale) {
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
    openDiagnostics: 'Open diagnostic logs',
    searchVersion: 'Search versions', showPrerelease: 'Show prereleases', refreshVersions: 'Refresh official versions', syncingVersions: 'Syncing official npm versions…',
    versionCount: (count: number) => `${count} version${count === 1 ? '' : 's'}`, latest: 'Latest', inUse: 'In use', switching: 'Switching…', switch: 'Switch', installing: 'Installing…', install: 'Install', uninstalling: 'Uninstalling…', uninstall: 'Uninstall',
    switchingTo: (version: string) => `Switching to ${version}…`, installingVersion: (version: string) => `Installing ${version}…`, uninstallingVersion: (version: string) => `Uninstalling ${version}…`,
    noMatchingVersions: 'No matching versions', refreshEmpty: 'Refresh to load versions from the official npm registry.', adjustFilters: 'Try adjusting the filters or search.', unknown: 'Unknown', unknownPublishDate: 'Publish date unknown',
    notRunning: 'Not running', starting: 'Starting', dshRunning: 'DSH running', stopping: 'Stopping', runtimeError: 'Runtime error',
    dshStartupFailed: 'Official DSH failed to start', dshStartupFailedSummary: 'This version returned an error. Expand details to see the cause.', copyError: 'Copy error', errorCopied: 'Copied', errorCopyFailed: 'Copy failed', viewDetails: 'View details', hideDetails: 'Hide details',
    officialErrorBoundary: 'These startup details came from official DSH. DSH Desktop did not modify your configuration or credentials.'
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
    openDiagnostics: '打开诊断日志',
    searchVersion: '搜索版本号', showPrerelease: '显示预发布版本', refreshVersions: '刷新官方版本', syncingVersions: '正在同步 npm 官方版本…',
    versionCount: (count: number) => `${count} 个版本`, latest: '最新', inUse: '使用中', switching: '切换中…', switch: '切换', installing: '安装中…', install: '安装', uninstalling: '卸载中…', uninstall: '卸载',
    switchingTo: (version: string) => `正在切换到 ${version}…`, installingVersion: (version: string) => `正在安装 ${version}…`, uninstallingVersion: (version: string) => `正在卸载 ${version}…`,
    noMatchingVersions: '没有符合条件的版本', refreshEmpty: '点击右上角刷新，从 npm 官方源获取版本。', adjustFilters: '试试调整筛选或搜索内容。', unknown: '未知', unknownPublishDate: '发布时间未知',
    notRunning: '未运行', starting: '启动中', dshRunning: 'DSH 运行中', stopping: '停止中', runtimeError: '运行异常',
    dshStartupFailed: '官方 DSH 启动失败', dshStartupFailedSummary: '当前版本返回了错误，展开详情可查看具体原因。', copyError: '复制错误', errorCopied: '已复制', errorCopyFailed: '复制失败', viewDetails: '查看详情', hideDetails: '收起详情',
    officialErrorBoundary: '以上为官方 DSH 的启动失败详情，DSH Desktop 未修改你的配置或凭据。'
  }
}

const Svg = ({ children }: { children: React.ReactNode }): React.JSX.Element => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
const GridIcon = (): React.JSX.Element => <Svg><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></Svg>
const CheckIcon = (): React.JSX.Element => <Svg><path d="m5 12 4 4L19 6"/></Svg>
const DownloadIcon = (): React.JSX.Element => <Svg><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></Svg>
const TrashIcon = (): React.JSX.Element => <Svg><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></Svg>
const SearchIcon = (): React.JSX.Element => <Svg><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></Svg>
const RefreshIcon = (): React.JSX.Element => <Svg><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.1 9A7 7 0 0 0 6 6.5L4 12m16 0-2 5.5A7 7 0 0 1 5.9 15"/></Svg>
const OpenIcon = (): React.JSX.Element => <Svg><path d="M14 4h6v6m0-6-9 9"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></Svg>
const ShieldIcon = (): React.JSX.Element => <Svg><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></Svg>
const NpmIcon = (): React.JSX.Element => <svg viewBox="0 0 36 14" aria-hidden="true"><path fill="currentColor" d="M0 0h36v12H18v2h-8v-2H0V0Zm2 2v8h4V4h2v6h4V2H2Zm12 0v10h4v-2h6V2H14Zm4 2h2v4h-2V4Zm8-2v8h4V4h2v6h2V2h-8Z"/></svg>

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
