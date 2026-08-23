import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { defaultRegistryUrl, proxyModeSchema, proxyUrlSchema, registryUrlSchema, releaseChannelSchema, repairModeSchema, type LocalePreference, type ProxyMode, type ReleaseChannel, type RepairMode } from '../shared/contracts'

export interface PersistedState {
  schemaVersion: 6
  selectedVersion: string | null
  selectedExternalId: string | null
  dismissedLatest: string | null
  localePreference: LocalePreference
  releaseChannel: ReleaseChannel
  registryUrl: string
  closeToTray: boolean
  startAtLogin: boolean
  proxyMode: ProxyMode
  manualProxyUrl: string | null
  repairMode: RepairMode
}

const defaults: PersistedState = {
  schemaVersion: 6,
  selectedVersion: null,
  selectedExternalId: null,
  dismissedLatest: null,
  localePreference: 'system',
  releaseChannel: 'all',
  registryUrl: defaultRegistryUrl,
  closeToTray: true,
  startAtLogin: false,
  proxyMode: 'system',
  manualProxyUrl: null,
  repairMode: 'auto'
}

export class StateStore {
  readonly file: string

  constructor(userData: string) {
    this.file = path.join(userData, 'desktop-state.json')
  }

  async read(): Promise<PersistedState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<PersistedState>
      return {
        schemaVersion: 6,
        selectedVersion: typeof parsed.selectedVersion === 'string' ? parsed.selectedVersion : null,
        selectedExternalId: typeof parsed.selectedExternalId === 'string' && /^[0-9a-f]{16}$/.test(parsed.selectedExternalId) ? parsed.selectedExternalId : null,
        dismissedLatest: typeof parsed.dismissedLatest === 'string' ? parsed.dismissedLatest : null,
        localePreference: ['system', 'zh-CN', 'en-US'].includes(parsed.localePreference ?? '') ? parsed.localePreference as LocalePreference : 'system',
        releaseChannel: releaseChannelSchema.safeParse(parsed.releaseChannel).success ? parsed.releaseChannel as ReleaseChannel : 'all',
        registryUrl: registryUrlSchema.safeParse(parsed.registryUrl).success ? registryUrlSchema.parse(parsed.registryUrl) : defaultRegistryUrl,
        closeToTray: typeof parsed.closeToTray === 'boolean' ? parsed.closeToTray : true,
        startAtLogin: typeof parsed.startAtLogin === 'boolean' ? parsed.startAtLogin : false,
        proxyMode: proxyModeSchema.safeParse(parsed.proxyMode).success ? parsed.proxyMode as ProxyMode : 'system',
        manualProxyUrl: proxyUrlSchema.safeParse(parsed.manualProxyUrl).success ? proxyUrlSchema.parse(parsed.manualProxyUrl) : null,
        repairMode: repairModeSchema.safeParse(parsed.repairMode).success ? parsed.repairMode as RepairMode : 'auto'
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { ...defaults }
    }
  }

  async write(state: PersistedState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  }
}
