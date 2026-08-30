// Plain-file credential storage, used when running from source. The desktop
// build does not use this - it encrypts through the OS credential store.
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Rewrites a single variable in a .env file, leaving every other line intact.
 * Pass null as the value to remove it.
 *
 * The variable name is a parameter rather than a constant because the app now
 * stores more than one credential; see server/providers.mjs.
 */
export function envStore(file) {
  return (name, value) => {
    let lines = []
    try {
      lines = readFileSync(file, 'utf8').split(/\r?\n/)
    } catch {
      /* file does not exist yet */
    }
    // Anchored to this variable only, so a second provider's key on another
    // line survives untouched.
    const assignment = new RegExp(`^\\s*${name}\\s*=`)
    const kept = lines.filter((l) => !assignment.test(l))
    if (value) kept.unshift(`${name}=${value}`)
    writeFileSync(file, kept.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
}
