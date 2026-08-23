import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { defaultRegistryUrl, registryUrlSchema, releaseChannelSchema, type LocalePreference, type ReleaseChannel } from '../shared/contracts'

export interface PersistedState {
  schemaVersion: 3
  selectedVersion: string | null
  selectedExternalId: string | null
  dismissedLatest: string | null
  localePreference: LocalePreference
  releaseChannel: ReleaseChannel
  registryUrl: string
}

const defaults: PersistedState = {
  schemaVersion: 3,
  selectedVersion: null,
  selectedExternalId: null,
  dismissedLatest: null,
  localePreference: 'system',
  releaseChannel: 'all',
  registryUrl: defaultRegistryUrl
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
        schemaVersion: 3,
        selectedVersion: typeof parsed.selectedVersion === 'string' ? parsed.selectedVersion : null,
        selectedExternalId: typeof parsed.selectedExternalId === 'string' && /^[0-9a-f]{16}$/.test(parsed.selectedExternalId) ? parsed.selectedExternalId : null,
        dismissedLatest: typeof parsed.dismissedLatest === 'string' ? parsed.dismissedLatest : null,
        localePreference: ['system', 'zh-CN', 'en-US'].includes(parsed.localePreference ?? '') ? parsed.localePreference as LocalePreference : 'system',
        releaseChannel: releaseChannelSchema.safeParse(parsed.releaseChannel).success ? parsed.releaseChannel as ReleaseChannel : 'all',
        registryUrl: registryUrlSchema.safeParse(parsed.registryUrl).success ? registryUrlSchema.parse(parsed.registryUrl) : defaultRegistryUrl
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
