import { lstat, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

export interface PruneResult {
  removedBytes: number
  removedFiles: number
  removedPrebuilds: string[]
}

const knownNodePtyPrebuild = /^(darwin|linux|win32)-(arm64|x64)$/
const windowsPrebuild = 'win32-x64'

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function measure(target: string): Promise<{ bytes: number; files: number }> {
  const info = await lstat(target)
  if (!info.isDirectory()) return { bytes: info.size, files: 1 }

  let bytes = 0
  let files = 0
  for (const entry of await readdir(target)) {
    const child = await measure(path.join(target, entry))
    bytes += child.bytes
    files += child.files
  }
  return { bytes, files }
}

async function removeDebugSymbols(target: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) {
      const removed = await removeDebugSymbols(child)
      bytes += removed.bytes
      files += removed.files
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdb')) {
      const info = await lstat(child)
      await rm(child)
      bytes += info.size
      files += 1
    }
  }
  return { bytes, files }
}

async function removeArm64Conpty(dshRoot: string): Promise<{ bytes: number; files: number }> {
  const conptyRoot = path.join(dshRoot, 'node_modules', 'node-pty', 'third_party', 'conpty')
  let versions
  try {
    versions = await readdir(conptyRoot, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return { bytes: 0, files: 0 }
    throw error
  }

  let bytes = 0
  let files = 0
  for (const version of versions) {
    if (!version.isDirectory()) continue
    const target = path.join(conptyRoot, version.name, 'win10-arm64')
    try {
      const measured = await measure(target)
      await rm(target, { recursive: true, force: true })
      bytes += measured.bytes
      files += measured.files
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  return { bytes, files }
}

/**
 * Removes only native artifacts that cannot run on the release target.
 * The official DSH package and its executable source remain untouched.
 */
export async function pruneBundledResources(
  dshRoot: string
): Promise<PruneResult> {
  const prebuildRoot = path.join(dshRoot, 'node_modules', 'node-pty', 'prebuilds')
  const prebuilds = await readdir(prebuildRoot, { withFileTypes: true })

  if (!prebuilds.some((entry) => entry.isDirectory() && entry.name === windowsPrebuild)) {
    throw new Error('node-pty 缺少 Windows x64 预编译文件')
  }

  let removedBytes = 0
  let removedFiles = 0
  const removedPrebuilds: string[] = []
  for (const entry of prebuilds) {
    if (!entry.isDirectory() || !knownNodePtyPrebuild.test(entry.name) || entry.name === windowsPrebuild) continue
    const target = path.join(prebuildRoot, entry.name)
    const measured = await measure(target)
    await rm(target, { recursive: true, force: true })
    removedBytes += measured.bytes
    removedFiles += measured.files
    removedPrebuilds.push(entry.name)
  }

  const symbols = await removeDebugSymbols(dshRoot)
  removedBytes += symbols.bytes
  removedFiles += symbols.files

  const arm64Conpty = await removeArm64Conpty(dshRoot)
  removedBytes += arm64Conpty.bytes
  removedFiles += arm64Conpty.files

  return { removedBytes, removedFiles, removedPrebuilds: removedPrebuilds.sort() }
}
