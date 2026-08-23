import semver from 'semver'
import { defaultRegistryUrl, exactVersionSchema, officialPackageName, registryUrlSchema, releaseChannelSchema, type ReleaseChannel } from '../shared/contracts'

interface RegistryDocument {
  versions?: Record<string, unknown>
  time?: Record<string, string>
}

export interface CatalogOptions {
  channel?: ReleaseChannel
  registryUrl?: string
}

export class DshRegistry {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async catalog(options: CatalogOptions = {}): Promise<{ latest: string | null; versions: Array<{ version: string; publishedAt: string | null }> }> {
    const channel = releaseChannelSchema.parse(options.channel ?? 'all')
    const registryBase = registryUrlSchema.parse(options.registryUrl ?? defaultRegistryUrl)
    const requestUrl = `${registryBase}/${encodeURIComponent(officialPackageName)}`
    const response = await this.fetcher(requestUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`无法查询官方 DSH 版本（HTTP ${response.status}）`)
    const data = await response.json() as RegistryDocument
    const allVersions = Object.keys(data.versions ?? {}).filter((value) => exactVersionSchema.safeParse(value).success)
    if (allVersions.length === 0) throw new Error('npm registry 未返回有效版本')
    const versionNames = allVersions.filter((version) => {
      const prerelease = semver.prerelease(version) !== null
      if (channel === 'stable') return !prerelease
      if (channel === 'preview') return prerelease
      return true
    })
    const latest = semver.rsort([...versionNames])[0] ?? null
    const versions = versionNames.map((version) => ({
      version,
      publishedAt: data.time?.[version] ?? null
    }))
    return { latest, versions }
  }
}
