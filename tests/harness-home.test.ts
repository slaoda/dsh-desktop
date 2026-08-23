import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveHarnessHome } from '../src/main/harness-home'

describe('resolveHarnessHome', () => {
  it('遵循 DSH_HOME、波浪号和默认主目录优先级', () => {
    const userHome = path.resolve('C:\\Users\\tester')
    expect(resolveHarnessHome({}, userHome)).toBe(path.join(userHome, '.dsh'))
    expect(resolveHarnessHome({ DSH_HOME: '~/custom-dsh' }, userHome)).toBe(path.join(userHome, 'custom-dsh'))
    expect(resolveHarnessHome({ DSH_HOME: 'C:\\HarnessData' }, userHome, 'win32')).toBe('C:\\HarnessData')
  })

  it('拒绝相对路径和 shell 表达式', () => {
    expect(() => resolveHarnessHome({ DSH_HOME: 'relative/home' }, '/users/tester')).toThrow('绝对路径')
    expect(() => resolveHarnessHome({ DSH_HOME: '$HOME/.dsh' }, '/users/tester')).toThrow('绝对路径')
  })
})

