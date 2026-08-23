import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import semver from 'semver'
import type { AppLocale, AppSnapshot, BackupScope, InstallProgress, LocalePreference, ProxyMode, ReleaseChannel } from '../shared/contracts'
import deepSeekWhale from './deepseek-whale.svg'
import { copy, localizeMessage } from './copy'
import { dshRuntimeFailureDetail, isDshRuntimeFailure } from './runtime-error'
import './style.css'

const initialLocale: AppLocale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
const empty: AppSnapshot = {
  appVersion: '0.1.0', nodeVersion: null, latestVersion: null, selectedVersion: null,
  locale: initialLocale, localePreference: 'system', releaseChannel: 'all', registryUrl: 'https://registry.npmjs.org',
  harnessHome: null, backups: [], externalInstallations: [], selectedExternalId: null,
  closeToTray: true, startAtLogin: false, proxyMode: 'system', manualProxyUrl: null, repairMode: 'auto',
  dismissedLatest: null, installedVersions: [], availableVersions: [], runtimeStatus: 'idle', runtimeUrl: null, repairSession: null, error: null
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
