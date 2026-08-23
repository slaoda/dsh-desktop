import { describe, expect, it } from 'vitest'
import { dshRuntimeFailureDetail, isDshRuntimeFailure } from '../src/renderer/runtime-error'
import { clipboardTextSchema } from '../src/shared/contracts'

describe('runtime error presentation', () => {
  it('仅把官方 DSH 启动失败放入当前版本错误卡片', () => {
    expect(isDshRuntimeFailure('failed', '官方 DSH 启动失败（退出码 1）：Error: failed')).toBe(true)
    expect(isDshRuntimeFailure('failed', '官方 DSH 在规定时间内未返回本地访问地址')).toBe(true)
    expect(isDshRuntimeFailure('failed', '安装失败')).toBe(false)
    expect(isDshRuntimeFailure('idle', '官方 DSH 启动失败（退出码 1）')).toBe(false)
    expect(isDshRuntimeFailure('running', '新版本 0.0.2 启动失败，已自动回退到 0.1.1-rc.2：官方 DSH 启动失败（退出码 1）：Error: failed')).toBe(true)
  })

  it('从启动消息中提取适合折叠态显示的错误详情', () => {
    expect(dshRuntimeFailureDetail('官方 DSH 启动失败（退出码 1）：Error: credentials failed')).toBe('Error: credentials failed')
    expect(dshRuntimeFailureDetail('官方 DSH 启动失败（退出码 1）')).toBe('')
    expect(dshRuntimeFailureDetail('新版本 0.0.2 启动失败，已自动回退到 0.1.1-rc.2：官方 DSH 启动失败（退出码 1）：Error: failed')).toBe('Error: failed')
  })

  it('限制渲染进程可写入剪贴板的诊断文本', () => {
    expect(clipboardTextSchema.parse('官方 DSH 启动失败')).toBe('官方 DSH 启动失败')
    expect(() => clipboardTextSchema.parse('')).toThrow()
    expect(() => clipboardTextSchema.parse('x'.repeat(4_097))).toThrow()
  })
})
