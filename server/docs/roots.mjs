// What gets indexed on a fresh install.
//
// The user asked for everything, so the default is the whole user profile -
// but only ever the profile. Never C:\, never another user's folder, never
// system directories: the crawler's skip list handles the noise inside, and
// this handles the outside. Roots are editable in the app afterwards.
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function defaultRoots() {
  const home = homedir()
  if (!home || !existsSync(home)) return []
  return [home]
}

/** The folders offered as one-click suggestions in the library panel. */
export function suggestedRoots() {
  const home = homedir()
  return ['Documents', 'Desktop', 'Downloads', 'OneDrive', 'Pictures']
    .map((n) => join(home, n))
    .filter((p) => existsSync(p))
}
