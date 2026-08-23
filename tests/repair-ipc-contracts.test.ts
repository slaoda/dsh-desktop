import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))

vi.mock('electron', () => ({
  clipboard: electron.clipboard,
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler) },
  shell: electron.shell
}))

import { registerIpc } from '../src/main/ipc'
import { channels } from '../src/shared/ipc-channels'

describe('repair IPC contracts', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('校验修复模式且不向控制器传递任意值', async () => {
    const controller = { setRepairMode: vi.fn(async (mode: string) => ({ repairMode: mode })) }
    registerIpc(controller as never, vi.fn(), vi.fn(), { log: vi.fn(), directory: 'logs' } as never)
    const handler = electron.handlers.get(channels.setRepairMode)

    await expect(handler?.({}, 'run-command')).rejects.toThrow()
    expect(controller.setRepairMode).not.toHaveBeenCalled()
    await expect(handler?.({}, 'ask')).resolves.toMatchObject({ repairMode: 'ask' })
    expect(controller.setRepairMode).toHaveBeenCalledWith('ask')
  })

  it('插件卸载需要显式确认，且渲染层只能提供已校验的 entry id', async () => {
    const controller = { uninstallQuarantinedPlugin: vi.fn(async (entryId: string) => ({ entryId })) }
    registerIpc(controller as never, vi.fn(), vi.fn(), { log: vi.fn(), directory: 'logs' } as never)
    const handler = electron.handlers.get(channels.uninstallQuarantinedPlugin)

    await expect(handler?.({}, 'plugin:web:test', false)).rejects.toThrow('确认')
    await expect(handler?.({}, '../../escape', true)).rejects.toThrow()
    expect(controller.uninstallQuarantinedPlugin).not.toHaveBeenCalled()
    await expect(handler?.({}, 'plugin:web:test', true)).resolves.toMatchObject({ entryId: 'plugin:web:test' })
    expect(controller.uninstallQuarantinedPlugin).toHaveBeenCalledWith('plugin:web:test')
  })

  it('确认修复由独立无参数通道触发', async () => {
    const controller = { confirmStartupRepair: vi.fn(async () => ({ runtimeUrl: 'http://127.0.0.1:1234' })) }
    const openHarnessWindow = vi.fn(async () => undefined)
    registerIpc(controller as never, vi.fn(), openHarnessWindow, { log: vi.fn(), directory: 'logs' } as never)

    await expect(electron.handlers.get(channels.confirmStartupRepair)?.({})).resolves.toMatchObject({ runtimeUrl: 'http://127.0.0.1:1234' })
    expect(controller.confirmStartupRepair).toHaveBeenCalledOnce()
    expect(openHarnessWindow).toHaveBeenCalledWith('http://127.0.0.1:1234')
  })

  it('主进程在写入剪贴板前再次脱敏', async () => {
    registerIpc({} as never, vi.fn(), vi.fn(), { log: vi.fn(), directory: 'logs' } as never)
    await electron.handlers.get(channels.copyText)?.({}, 'API_KEY=sk-never-copy proxy=https://alice:secret@example.test')

    expect(electron.clipboard.writeText).toHaveBeenCalledOnce()
    const copied = electron.clipboard.writeText.mock.calls[0][0] as string
    expect(copied).toContain('[REDACTED]')
    expect(copied).not.toContain('sk-never-copy')
    expect(copied).not.toContain('secret')
  })
})
