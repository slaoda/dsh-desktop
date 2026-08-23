import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const dshRoot = path.join(root, 'build-resources', 'dsh', '0.1.1-rc.2')

async function npmSbom(cwd: string, omitDev: boolean): Promise<string> {
  const npmCli = process.env.npm_execpath
  if (!npmCli) throw new Error('release:metadata 必须通过 npm script 执行')
  return await new Promise((resolve, reject) => {
    const args = [npmCli, 'sbom', '--sbom-format=cyclonedx', ...(omitDev ? ['--omit=dev'] : [])]
    const child = spawn(process.execPath, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(`npm sbom 失败：${stderr.slice(-500)}`)))
  })
}

interface CycloneDxLicense {
  license?: { id?: string; name?: string }
  expression?: string
}

interface CycloneDxBom {
  components?: Array<{ name?: string; group?: string; version?: string; licenses?: CycloneDxLicense[] }>
}

function licenses(sbom: string, label: string): string[] {
  const bom = JSON.parse(sbom) as CycloneDxBom
  return (bom.components ?? [])
    .filter((component) => component.name && component.version)
    .map((component) => {
      const packageName = component.group ? `${component.group}/${component.name}` : component.name
      const license = component.licenses?.map((entry) => entry.expression ?? entry.license?.id ?? entry.license?.name).filter(Boolean).join(' OR ') || 'SEE PACKAGE'
      return `${label}\t${packageName}\t${component.version}\t${license}`
    })
}

const desktopSbom = await npmSbom(root, true)
const officialDshSbom = await npmSbom(dshRoot, false)
await writeFile(path.join(releaseDir, 'dsh-desktop-sbom.cdx.json'), desktopSbom)
await writeFile(path.join(releaseDir, 'official-dsh-sbom.cdx.json'), officialDshSbom)
const licenseLines = [
  ...licenses(desktopSbom, 'DSH Desktop'),
  ...licenses(officialDshSbom, 'Official DSH runtime'),
  'Bundled runtime\tNode.js\tv24.18.1\tMIT (full text included in runtime/LICENSE)'
].sort()
await writeFile(path.join(releaseDir, 'THIRD-PARTY-LICENSES.txt'), `Component\tPackage\tVersion\tLicense\n${licenseLines.join('\n')}\n`)

const artifacts = (await readdir(releaseDir)).filter((name) => /\.(dmg|zip|exe)$/i.test(name)).sort()
const sums: string[] = []
for (const artifact of artifacts) {
  const digest = createHash('sha256').update(await readFile(path.join(releaseDir, artifact))).digest('hex')
  sums.push(`${digest}  ${artifact}`)
}
await writeFile(path.join(releaseDir, `SHA256SUMS-${process.platform}-${process.arch}`), `${sums.join('\n')}\n`)
console.log(`Release metadata generated for ${artifacts.length} artifact(s)`)
