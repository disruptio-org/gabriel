// Plain-file credential storage, used when running from source. The desktop
// build does not use this - it encrypts through the OS credential store.
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Rewrites a single variable in a .env file, leaving every other line intact.
 * Pass null to remove it.
 */
export function envStore(file) {
  return (key) => {
    let lines = []
    try {
      lines = readFileSync(file, 'utf8').split(/\r?\n/)
    } catch {
      /* file does not exist yet */
    }
    const kept = lines.filter((l) => !/^\s*ANTHROPIC_API_KEY\s*=/.test(l))
    if (key) kept.unshift(`ANTHROPIC_API_KEY=${key}`)
    writeFileSync(file, kept.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
}
