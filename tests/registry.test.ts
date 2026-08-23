import { describe, expect, it } from 'vitest'
import { DshRegistry } from '../src/main/registry'
import { registryUrlSchema } from '../src/shared/contracts'

describe('DshRegistry', () => {
  it('使用官方目录中的最高版本而不是滞后的 latest 标签', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      versions: { '0.1.0-rc.5': {}, '0.1.0-rc.6': {}, '0.1.0-rc.8': {}, '../bad': {} },
      'dist-tags': { latest: '0.1.0-rc.6' },
      time: { '0.1.0-rc.5': '2026-07-01T08:00:00.000Z', '0.1.0-rc.6': '2026-08-01T08:00:00.000Z', '0.1.0-rc.8': '2026-08-19T08:00:00.000Z' }
    }), { status: 200 })
    const registry = new DshRegistry(fetcher as typeof fetch)
    await expect(registry.catalog()).resolves.toEqual({ latest: '0.1.0-rc.8', versions: [
      { version: '0.1.0-rc.5', publishedAt: '2026-07-01T08:00:00.000Z' },
      { version: '0.1.0-rc.6', publishedAt: '2026-08-01T08:00:00.000Z' },
      { version: '0.1.0-rc.8', publishedAt: '2026-08-19T08:00:00.000Z' }
    ] })
  })

  it('按稳定版、预览版和全部版本渠道分类', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      versions: { '1.0.0': {}, '1.1.0-beta.1': {}, '1.1.0-beta.2': {}, '1.1.0': {}, '../bad': {} },
      'dist-tags': { latest: '1.1.0', next: '1.1.0-beta.2' }
    }), { status: 200 })
    const registry = new DshRegistry(fetcher as typeof fetch)

    await expect(registry.catalog({ channel: 'stable' })).resolves.toMatchObject({
      latest: '1.1.0', versions: [{ version: '1.0.0' }, { version: '1.1.0' }]
    })
    await expect(registry.catalog({ channel: 'preview' })).resolves.toMatchObject({
      latest: '1.1.0-beta.2', versions: [{ version: '1.1.0-beta.1' }, { version: '1.1.0-beta.2' }]
    })
    await expect(registry.catalog({ channel: 'all' })).resolves.toMatchObject({
      latest: '1.1.0', versions: [
        { version: '1.0.0' }, { version: '1.1.0-beta.1' }, { version: '1.1.0-beta.2' }, { version: '1.1.0' }
      ]
    })
  })

  it('允许无正式版的稳定渠道返回空目录', async () => {
    const fetcher = async () => new Response(JSON.stringify({ versions: { '0.1.0-rc.1': {} } }), { status: 200 })
    await expect(new DshRegistry(fetcher as typeof fetch).catalog({ channel: 'stable' })).resolves.toEqual({ latest: null, versions: [] })
  })

  it('使用经过校验的自定义镜像且拒绝嵌入式凭据', async () => {
    let requested = ''
    const fetcher = async (input: string | URL | Request) => {
      requested = String(input)
      return new Response(JSON.stringify({ versions: { '1.0.0': {} } }), { status: 200 })
    }
    const registry = new DshRegistry(fetcher as typeof fetch)
    await registry.catalog({ channel: 'all', registryUrl: 'https://registry.example.test/npm/' })
    expect(requested).toBe('https://registry.example.test/npm/%40deepseek-ai%2Fdsh')
    expect(registryUrlSchema.safeParse('https://user:secret@example.test').success).toBe(false)
    expect(registryUrlSchema.safeParse('file:///tmp/registry').success).toBe(false)
  })
})
