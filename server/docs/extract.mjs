// Text extraction. Pure JavaScript on purpose: no native modules to rebuild
// per Electron version, and - the point of the feature - nothing here opens a
// socket. Every format is parsed from bytes already on this machine.
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

// Read as text and trust the extension. Anything not listed is skipped by the
// crawler, so this map doubles as the definition of "a document".
const PLAIN = new Set([
  '.txt', '.md', '.markdown', '.rst', '.log', '.csv', '.tsv', '.json', '.jsonl',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.xml', '.html', '.htm',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.cs', '.php', '.c', '.h', '.cpp', '.hpp', '.sql', '.sh',
  '.ps1', '.bat', '.css', '.scss', '.vue', '.svelte', '.tex', '.bib',
])

const OFFICE = new Set(['.docx', '.pptx', '.xlsx'])

export const SUPPORTED = new Set([...PLAIN, ...OFFICE, '.pdf'])

/**
 * Credential shapes that must never survive into the index.
 *
 * The crawler already refuses files whose *names* look like secrets, but that
 * cannot see a key pasted into the middle of an ordinary script - and people do
 * hard-code them. Since the whole point of the index is to be shown to a model,
 * a key sitting in a passage is one approval click away from leaving the
 * machine. So it is stripped from the extracted text itself: the document stays
 * searchable and readable, the credential simply is not in it.
 *
 * Only distinctive, unambiguous prefixes are matched. A pattern loose enough to
 * catch every conceivable secret would redact half the user's prose.
 */
const SECRETS = [
  /sk-[A-Za-z0-9-]*[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, // GitHub
  /github_pat_[A-Za-z0-9_]{50,}/g,
  /AIza[0-9A-Za-z_-]{35}/g, // Google
  /xox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  /hf_[A-Za-z0-9]{30,}/g, // Hugging Face
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

/** Replaces anything credential-shaped with a marker. Exported so it can be tested. */
export const redactSecrets = (s) =>
  SECRETS.reduce((acc, re) => acc.replace(re, '[redacted credential]'), s)

/** Collapses runs of whitespace so passages stay readable and the index stays small. */
const tidy = (s) =>
  redactSecrets(s)
    .replace(/[\u0000\ufeff\u200b]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** Strips tags and decodes the handful of entities that actually show up. */
function fromMarkup(xml) {
  return xml
    .replace(/<(w:p|w:br|a:p|text:p|\/tr|\/p|\/div|br\s*\/?)>/gi, '$&\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m) =>
      ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' })[m] ?? ' ',
    )
}

/**
 * OOXML is a zip of XML parts. Rather than model each format, pull the parts
 * that hold body text and strip the markup - enough for search and for reading
 * a passage back, without a heavy dependency per format.
 */
function fromOfficeZip(buf, ext) {
  const files = unzipSync(new Uint8Array(buf))
  const wanted = (name) =>
    ext === '.docx'
      ? name === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(name)
      : ext === '.pptx'
        ? /^ppt\/slides\/slide\d+\.xml$/.test(name) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)
        : name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)

  // Slides and sheets are numbered, and lexical order puts 10 before 2.
  const num = (n) => Number(/(\d+)/.exec(n)?.[1] ?? 0)
  const parts = Object.keys(files).filter(wanted).sort((a, b) => num(a) - num(b))

  let out = ''
  for (const name of parts) out += fromMarkup(strFromU8(files[name])) + '\n\n'
  return out
}

/** Lazily loaded: pdf.js is large, and most files are not PDFs. */
let pdfjs = null

/**
 * Turns one page's text items into readable text.
 *
 * Naive concatenation produces "PPRROOCCEESSSSOO" on a great many real
 * documents: faux-bold is drawn by stamping every glyph twice a fraction of a
 * point apart, and pdf.js faithfully reports both. The doubling is invisible on
 * screen but wrecks the index - a heading becomes a token no one will ever
 * search for.
 *
 * The fix is to follow the pen. Each item knows where it starts and how wide it
 * is; an item starting left of where the previous one ended is re-drawing text
 * already emitted, so its overlapping prefix is dropped.
 */
export function pageText(items) {
  let out = ''
  let pen = null // x where the last glyph ended, or null at the start of a line

  for (const item of items) {
    const str = item.str ?? ''
    const x = item.transform?.[4]
    const measurable = typeof x === 'number' && item.width > 0

    if (str && pen !== null && measurable) {
      const overlap = pen - x
      // A hair of overlap is just kerning; a whole glyph of it is a redraw.
      // But geometry alone is not proof: table cells are emitted out of order
      // and can overlap without repeating anything, and trimming those eats a
      // real letter ("VERIFICADO" -> "ERIFICADO"). So the prefix must actually
      // repeat what was just written before it is dropped.
      const skip = overlap > 0.6 ? Math.min(str.length, Math.round(overlap / (item.width / str.length))) : 0
      out += skip > 0 && out.endsWith(str.slice(0, skip)) ? str.slice(skip) : str
    } else {
      out += str
    }

    if (measurable) pen = x + item.width
    if (item.hasEOL) {
      out += '\n'
      pen = null
    }
  }
  return out
}

async function fromPdf(buf, budget) {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs')
  // destroy() lives on the loading task, not on the document proxy - keep the
  // task around so a parse failure cannot leak a worker.
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    // This is someone's whole disk: assume every PDF is hostile. No script
    // evaluation, no font or resource fetching, no external requests.
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    // No standardFontDataUrl on purpose. Font data only matters for drawing
    // glyphs, and nothing here draws - getTextContent() reads the text layer.
    // Pointing it at node_modules would not work anyway: pdf.js fetches that
    // URL, and Node's fetch refuses file:// - it only ever produced warnings.
  })
  const doc = await task.promise

  try {
    let out = ''
    for (let p = 1; p <= doc.numPages && out.length < budget; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      out += pageText(content.items) + '\n\n'
      page.cleanup()
    }
    return out
  } finally {
    await task.destroy()
  }
}

/**
 * Returns the document's text, or null if it cannot be read as one.
 * `budget` caps how much of a single file enters the index - a 400MB log
 * should not be able to displace everything else.
 */
export async function extractText(file, { budget = 1_500_000 } = {}) {
  const ext = extname(file).toLowerCase()
  if (!SUPPORTED.has(ext)) return null

  const buf = await readFile(file)

  if (PLAIN.has(ext)) {
    // A UTF-16 BOM means the naive utf8 read would come back as mojibake.
    const enc = buf[0] === 0xff && buf[1] === 0xfe ? 'utf16le' : 'utf8'
    let text = buf.subarray(0, budget * 2).toString(enc)
    if (ext === '.html' || ext === '.htm' || ext === '.xml') text = fromMarkup(text)
    return tidy(text).slice(0, budget)
  }

  if (OFFICE.has(ext)) return tidy(fromOfficeZip(buf, ext)).slice(0, budget)
  if (ext === '.pdf') return tidy(await fromPdf(buf, budget)).slice(0, budget)
  return null
}
