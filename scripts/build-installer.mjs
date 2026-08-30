// Builds the Windows installer.
//
// electron-builder is run with its output outside the project: unpacking the
// Electron tree inside this folder fails with EPERM when it renames
// win-unpacked.tmp -> win-unpacked (Defender holds the freshly written tree).
// Writing single files here is fine, so the finished installer is copied back
// into release/ afterwards.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const staging = join(tmpdir(), 'pi-release')
const out = join(process.cwd(), 'release')

rmSync(staging, { recursive: true, force: true })

// shell: true is required on Windows - Node 22 refuses to spawn .cmd directly.
const r = spawnSync(
  'npx',
  ['electron-builder', '--win', `-c.directories.output=${staging}`],
  { stdio: 'inherit', shell: true },
)
if (r.status !== 0) process.exit(r.status ?? 1)

mkdirSync(out, { recursive: true })
const installers = readdirSync(staging).filter((f) => f.endsWith('.exe'))
for (const f of installers) copyFileSync(join(staging, f), join(out, f))

console.log(`\n  installer -> ${join(out, installers[0] ?? '(none found)')}`)
