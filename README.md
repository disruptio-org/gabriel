# Personal Intelligence

A button on your computer that summons an exceptional mind.

Implementation of the `Personal Intelligence.dc.html` Claude Design artboard,
built against the V1 requirements document the design was authored from.

---

## Running it

It is a Windows desktop app. Install
`release/Personal Intelligence Setup 1.0.0.exe`, or run it from source:

```bash
npm install
```

```bash
npm run app
```

### The API keys

Keys are **never** bundled into the app or committed.

Press **Ctrl+K** (or click the composer's `Ø NEEDS A CLAUDE CONNECTION - CONNECT`
line). The panel has a tab per provider:

| Provider | Needed for | Without it |
|---|---|---|
| **Claude** (`sk-ant-...`) | Everything Ø says | The app boots but cannot answer |
| **OpenAI** (`sk-...`) | Speech to text only | Chat is completely unaffected; the mic is visible but disabled |

Each key is verified against its provider before being stored - the cheapest
authenticated call that provider offers - and after that only its last four
characters are ever shown again (§16). DISCONNECT removes one.

Where they are stored depends on how you are running:

| Running | Keys stored in |
|---|---|
| Installed build | `credential.bin` and `credential-openai.bin` in `%APPDATA%\Personal Intelligence\`, encrypted with `safeStorage` (Windows DPAPI - decryptable only by this Windows user on this machine) |
| From source (`npm run app`, `npm run dev`) | `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env` in the project root |

An installed build also still reads `%APPDATA%\Personal Intelligence\.env` if
one is there, so a key placed by hand keeps working; the encrypted store wins.

The app runs without a key - it boots, animates and accepts input, and every
turn resolves to the graceful "Ø needs a Claude connection." state with CONNECT
and RETRY actions.

| Script | Does |
|---|---|
| `npm run app` | **Build and run the Windows desktop app** |
| `npm run app:build` | Build the installer into `release/` |
| `npm run app:dev` | Desktop app against the Vite dev server (hot reload) |
| `npm run dev` | Browser: UI + local service together |
| `npm run ui` | Vite only (port 5273) |
| `npm run svc` | Local service only (port 8787, override with `PI_PORT`) |
| `npm run build` | Typecheck + renderer bundle |
| `npm run typecheck` | Types only |

---

## Shape of the thing

- **`electron/main.mjs`** — the Windows shell. Frameless, transparent window;
  starts the service in-process on an OS-assigned free port and loads the
  renderer from it. Owns credential storage: `safeStorage.encryptString` on
  save, `decryptString` at launch, file removed on disconnect.
- **`electron/preload.cjs`** — the *only* renderer bridge. Exposes five window
  controls and nothing else: no Node, no filesystem, no credential access.
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **`server/index.mjs`** — the application service. `GET /api/health`,
  `POST /api/chat` (SSE), `POST /api/transcribe`, plus the built renderer when
  the shell passes it a static dir. Owns the Ø system prompt and the key
  endpoints (`POST`/`DELETE /api/key`); it never sends a key back, only a
  `•••• 1234` hint.
- **`server/providers.mjs`** — the credential registry: the only module that
  knows which providers exist, which environment variable each key lives in, and
  what a valid one looks like. It exists so the single-key assumption is in one
  file rather than spread across the `.env` writer, the vault and `/api/health`.
  No renderer code reads a key; this process does.
- **`src/`** — the renderer (React + TypeScript). Talks only to `/api/*`.

The renderer is loaded over loopback rather than `file://` so relative `/api`
fetches behave identically in the app and in the browser. The key never reaches
renderer code, is never bundled into the installer, and is never logged (§16).

### The local library

Ø can read the documents on this machine. The whole feature is local by
construction:

- **`server/docs/extract.mjs`** — text out of `.pdf`, `.docx`, `.pptx`,
  `.xlsx`, Markdown, code and plain text. Pure JavaScript (`fflate`,
  `pdfjs-dist`), so there is no native module to rebuild — and nothing in it
  opens a socket. pdf.js runs with `isEvalSupported: false`, no system fonts and
  no remote resources: every PDF on a disk is treated as hostile input.
- **`server/docs/index.mjs`** — the crawler and a BM25 inverted index, stored
  under `%APPDATA%\Personal Intelligence\index\`. Incremental: a file whose
  size and mtime are unchanged is never re-read.
- **`server/docs/search.mjs`** — ranked search, and the passage picker that
  finds the densest window of query terms in a document.

**What is never indexed.** Indexing a whole user profile would otherwise sweep
up the user's own secrets and put them one click from leaving the machine, so
credential-shaped files are skipped outright: `.env*`, `*.pem`, `*.key`,
`*.pfx`, `id_rsa*`, `credentials*`, `secrets*`, `.npmrc`, `.netrc`, and
anything whose name contains `secret`/`token`/`password`/`apikey`. Machine
directories (`node_modules`, `.git`, `AppData`, `dist`, build caches) are
skipped too, along with dotfolders and files over 25 MB. Roots default to the
user's profile and nothing above it.

A filename filter cannot see a key hard-coded in the middle of an ordinary
script, and people do hard-code them - a scan of one real profile found live
API keys inside three `.py` and `.docx` files. So extraction has a second pass:
anything credential-shaped (`sk-...`, `AKIA...`, `ghp_...`, `AIza...`, `xox?-`,
`hf_...`, PEM private-key blocks) is replaced with `[redacted credential]`
before the text is ever written to the index. The document stays searchable and
readable; the credential is simply not in it.

**The approval gate.** A send with DOCS ON searches the index locally, and if
anything matches, the approval sheet opens *before* the request is made. It
shows each file and the exact passage that would be attached; untick anything,
or send with none. This is per send, every time.

The renderer never supplies attachment text — only a reference
(`{id, offset, length}`). The service slices that passage out of the same
cached extraction the sheet was rendered from, so what was approved and what
is transmitted are read from the same bytes, and a compromised renderer cannot
substitute a different file. References to documents outside the configured
roots resolve to nothing.

Passages are capped at 4,000 characters each and 10 per turn. `Ctrl+D` opens
the library to browse, search, read a document in-app, and add or remove
folders. Indexing is never automatic: the library shows `REINDEX` and a live
count, and can be stopped mid-crawl.

**Checks.** `npm test` runs [`test/privacy.test.mjs`](test/privacy.test.mjs),
which exercises each of the claims above rather than leaving them as prose: the
filename filter, the redaction pass, the PDF pen-tracking, every way a forged
attachment reference can be refused, and - against a local server standing in
for the API - exactly what the service puts on the wire. It contacts nothing.

**Scans are not failures.** A PDF that is a photograph of a page has no text
layer, so there is nothing to extract without OCR. Those are counted separately
as `SCANS (NO TEXT)`; `UNREADABLE` is reserved for files that genuinely could
not be parsed - encrypted PDFs, corrupt archives, files locked by another
program. Conflating the two made a healthy index look broken.

### Voice, and where the audio goes

Ø can listen. This is the one part of the app that is **not** local, and it is
worth being exact about, because everything else here is.

**A recording leaves this machine.** Pressing the microphone records audio in
memory and uploads it to OpenAI, which turns it into text. The text is what
reaches Claude; the audio never does. This is different from the document
library, where nothing leaves without a per-send tick — so it is disclosed
once, in a modal shown before the microphone is ever opened, and the answer is
remembered.

It is also disclosed to Ø. The `SYSTEM` prompt in `server/index.mjs` describes
the audio path in the same terms as the document path, and tells Ø in as many
words not to claim the user's voice stays on their computer. Asked where its
audio goes, Ø answers correctly rather than reciting a promise the app stopped
keeping.

**What is retained: nothing.** The recording exists as a `Blob` in renderer
memory, is posted to the local service, is forwarded once, and is dropped when
the transcript returns. It is never written to disk, never logged, never put in
`localStorage`, and there is no recording history. What survives a voice turn is
its text, as an ordinary message.

**Two ways to use it.**

- **Dictation** — click the mic (or `Ctrl+Space`), speak, click again. The
  transcript lands in the composer as editable text and is **never auto-sent**.
  You own it until you press Enter. `Esc` discards the recording.
- **Hands-free** — the `VOICE ON` pill. Ø listens, notices when you have
  stopped talking, sends the sentence itself, and reopens the microphone once
  the answer finishes. `Esc` leaves.

Turn-taking is a Web Audio RMS meter on a 50ms tick: about 1.2s below threshold
ends the turn, 60s caps it, and anything under 0.4s of speech is discarded
without a request — a cough should not cost a round trip. The threshold is
calibrated from the first moments of the room rather than fixed, so a quiet room
does not make its own fan count as talking.

**DOCS and hands-free are mutually exclusive.** The approval sheet is a consent
gate, and hands-free has nobody at the keyboard to tick it. Rather than let one
mode silently weaken the other, enabling either disables the other and the
disabled pill says why. During a hands-free turn no local search runs at all, so
there are no passages to offer.

- **`server/voice.mjs`** — the only place a recording is sent anywhere. Calls
  OpenAI's `gpt-4o-transcribe` over plain `fetch`; there is no second SDK in the
  dependency tree. Chosen over `whisper-1` for a lower word error rate and for
  handling a sentence that switches language mid-way.
- **`src/lib/voice.ts`** — capture and the silence detector. The microphone
  track is stopped on every exit path, so the Windows recording indicator never
  outlives the recording.

**Checks.** [`test/voice.test.mjs`](test/voice.test.mjs) points the OpenAI base
URL at a local server and asserts the promises rather than the behaviours: with
no key, zero upload attempts are made at all; silence and oversized recordings
are refused before the network; a real recording arrives byte-identical at
`/audio/transcriptions` and leaves no file anywhere under the app directory; and
the OpenAI key appears in no response the renderer can read, only as a bearer
token on the way out. It contacts nothing.

### The icon

`build/icon.ico` is generated, not drawn by hand - `npm run icon` runs
[`scripts/make-icon.py`](scripts/make-icon.py), which rebuilds it from the same
numbers the app uses: the ring and incision geometry from `Glyph.tsx`, on the
launcher tile from `Desktop.tsx`. Change the glyph and the icon can follow.

One deliberate difference: the glyph is drawn larger than the launcher's 44/96
ratio and at full opacity rather than the in-app 0.55. Requirements §4.2 ask the
silhouette to survive at 16px, and a taskbar icon has no label beside it to lean
on. The `.ico` carries 16/24/32/48/64/128/256px entries.

### Packaging

`npm run app:build` produces an NSIS installer in `release/` (~112 MB). It goes
through `scripts/build-installer.mjs` rather than calling `electron-builder`
directly, because unpacking the Electron tree *inside* this folder fails with
`EPERM` when it renames `win-unpacked.tmp` -> `win-unpacked` - Windows holds the
freshly written tree. The script builds to a staging directory under `%TEMP%`
and copies the finished installer back; writing single files here is fine.

The installer carries no credential: verified by `asar list` (no `.env` in the
package) and by grepping the whole 112 MB installer and the unpacked tree for
`sk-ant-` - zero matches.

### Window chrome is real

The app draws its own titlebar — that was the design, and under Electron it is
now the actual window chrome. `─ ▢ ✕` drive real minimize / maximize / close
through the preload bridge, the titlebar is a drag region, and changing phase
resizes the OS window (launcher 380x300 → chat 1020x720) instead of animating a
`div`.

`src/lib/shell.ts` is the seam. When `window.pi` is absent — i.e. in a browser
tab — every one of those falls back to the in-page behaviour, so `npm run dev`
still works unchanged for development.

```
src/
  App.tsx              phase machine (desktop -> boot -> chat), window sizing, global keys
  components/
    Desktop.tsx        the launcher
    Boot.tsx           summon sequences A-E
    Chat.tsx           turns, thinking state, errors, copy/regenerate
    Composer.tsx       input, send/stop, status line
    Glyph.tsx          the Ø, as SVG (dormant | ready | thinking | icon)
    Markdown.tsx       response renderer - React elements only, never HTML injection
  lib/claude.ts        SSE client
  config.ts            localStorage config + reduced-motion resolution
  theme.ts             design tokens lifted from the artboard
```

### Source material

`design/` holds the originals this was built from, for reference — not part of
the build, not imported by anything:

```
design/
  Personal Intelligence.dc.html                     the artboard
  support.js                                        the dc-runtime it loads
  uploads/personal_intelligence_v1_requirements.md  the V1 spec
```

The artboard is the authority on palette, animation timings, glyph geometry and
window sizing; the requirements document is the authority on behaviour. Where
they disagree with what shipped, see below.

---

## Deviations from the artboard

Deliberate, and each one is a change of substance rather than of style:

**Model is `claude-opus-5`, not the artboard's `claude-sonnet-4-5`.**
Current-generation default. `claude-sonnet-5` and `claude-haiku-4-5` are also
offered by `/api/health`.

**Adaptive thinking is on** (`thinking: { type: "adaptive" }`). Note that
`budget_tokens` is rejected outright by Opus 5 — adaptive is the current form.

**Server-side refusal fallbacks are enabled**
(`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). This
means a request Opus 5 refuses may be silently served by a fallback model
instead of failing. If you would rather see the refusal, drop the beta — the
service already retries once without fallbacks when a `BadRequestError` arrives
before any output.

**Streaming is real.** The artboard simulated output with a `revealTimer`; here
text is rendered as it arrives off the wire, and the thinking state ends on the
first delta rather than on a timer.

**Markdown tables were added.** FR-13 calls for them and the artboard's renderer
had no table support.

**Headings, lists and blockquotes render as real `h1`–`h4`, `ul`/`ol`/`li` and
`blockquote`.** The artboard drew them as styled `div`s, which looks identical
but leaves a screen reader with no document structure (§18). The accent bullet
glyph is drawn by hand and hidden with `aria-hidden`, since the list element
already conveys position and count.

**Tauri is deferred.** The requirements name a desktop shell; there is no
default Rust toolchain on this machine, so this ships as Vite + a local Node
service. The split was chosen to keep that door open: the renderer is already
isolated from all credential handling, so wrapping it in Tauri means replacing
`server/index.mjs` with a Rust command and swapping the four `fetch` calls in
`src/lib/claude.ts` — no component changes.

---

## Verified behaviour

Checked in a browser against the running app:

- Boot sequence runs A→E in order (fragment scatter → `INITIALIZING` →
  `CONTEXT: READY` → `REASONING: ONLINE` → glyph → greeting → question), and
  skips to the end on any key or click.
- Send on Enter and on the `↵` button; Shift+Enter newlines.
- Streaming render: response text grows progressively, thinking labels cycle
  (`thinking` → `examining assumptions` → `considering alternatives` →
  `synthesizing`) at 1700ms, status line tracks `REASONING` → `STREAMING` →
  `READY`.
- Markdown: headings, tables, fenced code with language + COPY, inline code,
  bold, italic, links (`rel="noreferrer noopener"`), blockquotes, lists, `hr`.
- Esc stops mid-stream: partial text is kept and marked `GENERATION STOPPED.`
- COPY (`COPY → COPIED → COPY`) and REGENERATE on the last assistant turn.
- Error turn with RETRY when no key is configured; RETRY re-runs from the last
  user message.
- Maximize/restore, minimize/close to desktop, new conversation via `+` and
  Ctrl+N.
- Key entry: Ctrl+K and the composer's CONNECT line both open the panel; a
  malformed key is refused without a network call, a well-formed but invalid one
  comes back `Claude rejected that key.`, and the field is cleared either way.
  A good key flips the status line to READY without a restart, and the panel
  then shows only `STORED: •••• 1234`. DISCONNECT clears both the running
  service and the stored credential.

The streaming, markdown, stop and regenerate checks above were first run against
a throwaway local service speaking the same `/api/chat` SSE wire format, which
covers the whole renderer.

Against the real API (`claude-opus-5`, adaptive thinking), verified end to end
in the browser:

- A real token stream renders progressively as it arrives, `REASONING` ->
  `STREAMING` -> `READY`, and the thinking state ends on the first delta.
- Real model markdown renders as semantic elements: `h2`, `ul`/`li`, `table`
  with `th`, `pre`, `code`, `blockquote`, `strong`,
  `a[rel="noreferrer noopener"]`.
- Esc mid-stream keeps the partial text, marks it `GENERATION STOPPED.` and the
  text does not grow afterwards - the abort reaches Anthropic, it is not just a
  UI state change. Escaping *before* the first delta correctly leaves no turn at
  all, since the assistant message is created by the first delta.
- `BadRequestError` fallback-retry fires and retries once without `fallbacks`.
- Error mapping: a bad key produces `kind: "auth"` with the 401 detail intact,
  surfaced as an error turn.

Still unverified: the refusal path and the `rate_limit` branch, neither of which
can be triggered on demand.

Voice is verified only at the service boundary, by `test/voice.test.mjs`.
Everything downstream of a real microphone - the consent modal in situ,
capture, transcription quality, how the 1.2s turn-end actually feels, auto-send
and the mic reopening - has not been exercised, because the automated browser
refuses `getUserMedia` outright. It needs a manual pass in a packaged build,
including one with the Windows microphone toggle off, which fails identically to
a denied browser permission and so has its own message.

### Identity-linked keys

If the API answers `anthropic-workspace-id is required when authenticating with
an identity-linked API key`, set `ANTHROPIC_WORKSPACE_ID` in `.env` to the
workspace the key belongs to. Ordinary workspace keys must not send that header,
so it is only attached when the variable is set.
