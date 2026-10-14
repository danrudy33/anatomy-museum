import { host, useValue, useQuery, queryClient, Button, SearchField, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, SandboxedFrame, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import { useEffect, useState, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export const ID = 'anatomy-museum'
export const SITE = 'https://skills.wheresryan.sh/anatomy/community'
export function workshopPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) return null
  // Explicit frontend-local absolute path only; never infer a home or remote path.
  return /^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(value) ? value : null
}
export const LIMIT = 240
const ROOT = 'https://raw.githubusercontent.com/wheresryan22/anatomy-community/'
const BRANCH = 'https://api.github.com/repos/wheresryan22/anatomy-community/branches/previews'
const KINDS = new Map([['SVG', 'svg'], ['WebGL', 'webgl'], ['SVG + WebGL', 'webgl'], ['3D', '3d'], ['SVG + 3D', '3d']])
const EMPTY = { query: '', tag: '', kind: '', favoritesOnly: false, favorites: [] }
const fail = message => { throw new Error(message) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
function text(value, name, max, optional = false) {
  if (optional && value == null) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(`Invalid ${name}`)
  return value
}
function integer(value, name, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`Invalid ${name}`)
  return value
}
export function identity(row) {
  if (!object(row) || typeof row.author !== 'string' || typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(row.author) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(row.id)) fail('Invalid figure identity')
  return `${row.author}/${row.id}`
}
export function safeUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['raw.githubusercontent.com', 'github.com', 'skills.wheresryan.sh', 'creativecommons.org', 'opensource.org'].includes(url.hostname)) fail('Unsafe URL')
  return url.href
}
export function validateIndex(raw) {
  if (!object(raw) || raw.version !== 2) fail('Unsupported catalog schema')
  const total = integer(raw.total, 'total', 100000)
  const perPage = integer(raw.perPage, 'page size', 48)
  if (!perPage) fail('Invalid page size')
  const pages = integer(raw.pages, 'pages', 100000)
  if (pages !== Math.ceil(total / perPage) && !(total === 0 && pages === 1)) fail('Inconsistent page count')
  const updated = text(raw.updated, 'updated', 64)
  if (!Number.isFinite(Date.parse(updated))) fail('Invalid catalog timestamp')
  return { total, perPage, pages, updated }
}
export function validateFigure(raw, sha, expected, detail = false) {
  if (!/^[a-f0-9]{40}$/.test(sha)) fail('Invalid catalog revision')
  const key = identity(raw)
  if (expected && key !== expected) fail('Figure identity changed')
  // Upstream folderOf() lowercases only the validated ASCII author. Keep the
  // exact author/id key for attribution/preferences; never repair source ids.
  const assetSlug = `${raw.author.toLowerCase()}/${raw.id}`
  const title = text(raw.title, 'title', 240)
  const snippet = text(raw.snippet, 'snippet', 1000)
  if (!KINDS.has(raw.kind)) fail('Unknown rendering kind')
  if (!Array.isArray(raw.tags) || raw.tags.length > 24 || raw.tags.some(tag => typeof tag !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(tag)) || new Set(raw.tags).size !== raw.tags.length) fail('Invalid subject tags')
  const imagePath = raw.image
  if (![ `cards/${assetSlug}.webp`, `previews/${assetSlug}.webp` ].includes(imagePath)) fail('Invalid thumbnail path')
  const figure = { key, assetSlug, id: raw.id, author: raw.author, title, snippet, tags: [...raw.tags], kind: raw.kind, renderKind: KINDS.get(raw.kind), image: safeUrl(`${ROOT}${sha}/${imagePath}`), sha }
  if (detail) {
    if (!['MIT', 'CC-BY-4.0'].includes(raw.license)) fail('Unsupported figure license')
    if (raw.live !== `live/${assetSlug}.html` || raw.source !== `figures/${assetSlug}`) fail('Invalid provenance path')
    Object.assign(figure, { prompt: text(raw.prompt, 'prompt', 16000), license: raw.license, live: safeUrl(`https://skills.wheresryan.sh/anatomy/media/community/${raw.live}`), source: safeUrl(`https://github.com/wheresryan22/anatomy-community/tree/${sha}/${raw.source}`), website: safeUrl(`${SITE}/${assetSlug}`), rawLive: safeUrl(`${ROOT}${sha}/${raw.live}`) })
    // Source lives on main, not previews. BUILT_FROM is applied by loadCatalog.
  }
  return figure
}
export async function boundedJson(url, { signal, fetcher = fetch, maxBytes = 2 * 1024 * 1024 } = {}) {
  const timer = new AbortController()
  const abort = () => timer.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) timer.abort()
  const timeout = setTimeout(abort, 15000)
  try {
    const response = await fetcher(url, { signal: timer.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' })
    if (!response.ok) fail(`Catalog request failed (HTTP ${response.status})`)
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) fail('Catalog response exceeds size limit')
    const reader = response.body?.getReader()
    if (!reader) fail('Catalog response is not streamable')
    let size = 0
    const chunks = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) fail('Catalog response exceeds size limit')
        chunks.push(value)
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}
export async function loadCatalog({ signal, fetcher = fetch, limit = LIMIT } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const deadline = setTimeout(abort, 90000)
  try { return await loadSnapshot({ signal: controller.signal, fetcher, limit }) }
  finally {
    // A failed validation cancels sibling workers immediately, not after they
    // finish fetching the rest of a now-unusable snapshot in the background.
    abort(); clearTimeout(deadline); signal?.removeEventListener('abort', abort)
  }
}
async function loadSnapshot({ signal, fetcher, limit }) {
  integer(limit, 'collection limit', LIMIT)
  if (!limit) fail('Invalid collection limit')
  const options = { signal, fetcher }
  const branch = await boundedJson(BRANCH, { ...options, maxBytes: 65536 })
  const sha = branch?.commit?.sha
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) fail('Invalid catalog revision')
  const root = `${ROOT}${sha}/`
  const index = validateIndex(await boundedJson(`${root}index.json`, options))
  const rows = []
  const keys = new Set()
  const pageCount = Math.min(index.pages, 5, Math.ceil(limit / index.perPage))
  const effectiveLimit = Math.min(limit, 5 * index.perPage)
  for (let page = 1; page <= pageCount; page++) {
    const data = await boundedJson(`${root}feed/page-${page}.json`, options)
    if (!object(data) || data.page !== page || data.pages !== index.pages || !Array.isArray(data.figures)) fail('Invalid catalog pagination')
    const expectedCount = Math.min(index.perPage, Math.max(0, index.total - (page - 1) * index.perPage))
    if (data.figures.length !== expectedCount) fail('Page count does not match index')
    for (const raw of data.figures) {
      const row = validateFigure(raw, sha)
      if (keys.has(row.assetSlug)) fail('Duplicate catalog identity')
      keys.add(row.assetSlug)
      if (rows.length < effectiveLimit) rows.push(row)
    }
  }
  // Built source revision is fetched as a tiny text document, with JSON-style streaming bounds.
  const built = await boundedJson(`${BRANCH.replace('/branches/previews', '/contents/BUILT_FROM')}?ref=${sha}`, { ...options, maxBytes: 16384 })
  if (!object(built) || built.encoding !== 'base64' || typeof built.content !== 'string' || built.content.length > 512) fail('Invalid source revision')
  const sourceSha = atob(built.content.replace(/\s/g, '')).trim()
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail('Invalid source revision')
  let cursor = 0
  const figures = new Array(rows.length)
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (cursor < rows.length) {
      const at = cursor++
      const row = rows[at]
      const raw = await boundedJson(`${root}feed/figures/${row.assetSlug}.json`, { ...options, maxBytes: 65536 })
      const full = validateFigure(raw, sha, row.key, true)
      if (full.title !== row.title || full.kind !== row.kind || full.image !== row.image || JSON.stringify(full.tags) !== JSON.stringify(row.tags)) fail('Inconsistent catalog detail')
      full.source = safeUrl(`https://github.com/wheresryan22/anatomy-community/tree/${sourceSha}/${raw.source}`)
      figures[at] = full
    }
  }))
  const complete = figures.length === index.total
  if (index.total <= effectiveLimit && !complete) fail('Collected count does not match declared total')
  return { ...index, sha, sourceSha, figures, complete, fetchedAt: new Date().toISOString() }
}

// Official CI standalone pages, not the website's framing-restricted wrapper.
export const LIVE_MAX_BYTES = 4 * 1024 * 1024
export function standaloneUrl(figure) {
  const key = identity(figure)
  const slug = `${figure.author.toLowerCase()}/${figure.id}`
  if (figure.key !== key || figure.assetSlug !== slug || !/^[a-f0-9]{40}$/.test(figure.sha) || !['MIT', 'CC-BY-4.0'].includes(figure.license)) fail('Invalid standalone identity or license')
  const url = `${ROOT}${figure.sha}/live/${slug}.html`
  if (figure.rawLive !== url || !new RegExp(`^https://github\\.com/wheresryan22/anatomy-community/tree/[a-f0-9]{40}/figures/${slug}$`).test(figure.source)) fail('Invalid standalone provenance')
  return url
}
export async function loadStandalone(figure, { signal, fetcher = fetch, timeoutMs = 15000 } = {}) {
  const url = standaloneUrl(figure)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(abort, timeoutMs)
  let reader, body
  try {
    controller.signal.throwIfAborted()
    const response = await fetcher(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' })
    body = response.body
    if (!response.ok) fail(`Figure request failed (HTTP ${response.status})`)
    if (response.url && response.url !== url) fail('Figure response identity changed')
    if (!/^(?:text\/plain|text\/html)\s*;\s*charset\s*=\s*utf-8\s*$/i.test(response.headers.get('content-type') || '')) fail('Figure must be UTF-8 plain text or HTML')
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > LIVE_MAX_BYTES)) fail('Figure exceeds 4 MiB limit')
    reader = response.body?.getReader()
    if (!reader) fail('Figure response is not streamable')
    // Cancel even a stalled reader on timeout/owner cleanup.
    const cancel = () => { void reader.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', cancel, { once: true })
    let size = 0
    const chunks = []
    try {
      while (true) {
        controller.signal.throwIfAborted()
        const { done, value } = await reader.read()
        controller.signal.throwIfAborted()
        if (done) break
        size += value.byteLength
        if (size > LIVE_MAX_BYTES) fail('Figure exceeds 4 MiB limit')
        chunks.push(value)
      }
    } finally { controller.signal.removeEventListener('abort', cancel) }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!/^\s*<!doctype html>/i.test(html.slice(0, 64)) || html.includes('\u0000')) fail('Not a standalone HTML page')
    // Conservative reject-only gate, not an HTML sanitizer. Never rewrite scripts,
    // CSP or notices. Upstream's standalone contract forbids outside dependencies.
    if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b[^>]*\bhref\s*=/i.test(html) || /<(?:iframe|object|embed)\b/i.test(html)) fail('Standalone page declares external or nested dependencies')
    controller.signal.throwIfAborted()
    return { src: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`, bytes: size, url }
  } catch (error) {
    if (reader) await reader.cancel().catch(() => {})
    else await body?.cancel().catch(() => {})
    throw error
  }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

export function scopeKey(connectionId, profile) {
  if (typeof connectionId !== 'string' || !connectionId.trim() || typeof profile !== 'string' || !profile.trim()) return null
  return JSON.stringify([connectionId, profile])
}
export function preferences(raw) {
  if (!object(raw)) return { ...EMPTY, favorites: [] }
  const favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(key => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,79}$/.test(key)))].slice(0, 1000) : []
  return { query: typeof raw.query === 'string' ? raw.query.slice(0, 200) : '', tag: typeof raw.tag === 'string' && /^[a-z0-9-]{1,64}$/.test(raw.tag) ? raw.tag : '', kind: ['svg', 'webgl', '3d'].includes(raw.kind) ? raw.kind : '', favoritesOnly: raw.favoritesOnly === true, favorites }
}
export function selectFigures(catalog, prefs) {
  const words = prefs.query.trim().toLocaleLowerCase()
  return (catalog?.figures || []).filter(row => (!prefs.tag || row.tags.includes(prefs.tag)) && (!prefs.kind || row.renderKind === prefs.kind) && (!prefs.favoritesOnly || prefs.favorites.includes(row.key)) && (!words || [row.title, row.prompt, ...row.tags].some(value => value.toLocaleLowerCase().includes(words))))
}
export function subjectTags(figures) {
  const tags = new Map()
  for (const row of figures) for (const tag of row.tags) tags.set(tag, (tags.get(tag) || 0) + 1)
  return [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
export function resultLabel(catalog, count, hasFilter) {
  if (!catalog) return 'Collection not loaded'
  if (!catalog.complete) return `${count} matches in ${catalog.figures.length} loaded of ${catalog.total} — incomplete catalog; absence is not verified`
  if (!count) return hasFilter ? 'No matching figures in the complete catalog' : 'Verified empty collection'
  return `${count}${hasFilter ? ' matches' : ' figures'} · complete catalog (${catalog.total})`
}

export const CSS = `
.am{height:100%;min-height:0;overflow:auto;color:var(--ui-text-primary);font-size:13px;line-height:1.5;container-type:inline-size}
.am *{box-sizing:border-box}.am button{font:inherit}.am button:focus-visible,.am a:focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px}
.am-wrap{max-width:1400px;margin:auto;padding:28px 32px 48px}.am-top,.am-toolbar,.am-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.am-top{justify-content:space-between;margin-bottom:28px}.am-kicker{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--ui-accent)}
.am h1{font-size:30px;font-weight:550;letter-spacing:-.04em;line-height:1.15;margin:7px 0}.am p{margin:6px 0}.am-muted{color:var(--ui-text-secondary)}.am-small{font-size:11px;color:var(--ui-text-tertiary)}
.am-toolbar{padding:14px 0;border-top:1px solid var(--ui-stroke-secondary);border-bottom:1px solid var(--ui-stroke-secondary)}.am-search{flex:1;min-width:180px!important;opacity:1!important}.am-search input{width:100%}
.am-filters{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:14px 0}.am-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ui-text-tertiary);margin-right:5px}
.am-chip{border:1px solid var(--ui-stroke-secondary);border-radius:20px;padding:4px 10px;background:transparent;color:var(--ui-text-secondary);cursor:pointer}.am-chip:hover{color:var(--ui-accent);border-color:var(--ui-accent)}.am-chip[aria-pressed=true]{border-color:var(--ui-accent);color:var(--ui-accent);background:var(--ui-bg-secondary)}
.am-status{padding:12px 0;min-height:46px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.am-warning{border:1px solid var(--ui-yellow);padding:12px 16px;border-radius:8px;color:var(--ui-text-primary);margin:12px 0}
.am-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:20px}.am-card{border:1px solid var(--ui-stroke-secondary);border-radius:12px;overflow:hidden;position:relative;background:var(--ui-bg-secondary)}.am-card:hover{border-color:var(--ui-accent)}
.am-card-open{display:block;width:100%;border:0;padding:0;background:transparent;text-align:left;color:inherit;cursor:pointer}.am-image{width:100%;aspect-ratio:4/3;object-fit:contain;display:block}.am-placeholder{display:grid;place-items:center;aspect-ratio:4/3;color:var(--ui-text-tertiary);padding:24px}.am-body{padding:14px 16px}.am-title{font-size:15px;font-weight:550;margin-bottom:5px;line-height:1.35}.am-snippet{font-size:12px;color:var(--ui-text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px;margin-top:10px}
.am-card-foot{display:flex;justify-content:space-between;align-items:center;padding:0 16px 14px;gap:10px}.am-kind{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--ui-text-tertiary)}.am-empty{padding:48px 20px;border:1px dashed var(--ui-stroke-secondary);border-radius:12px;text-align:center}
.am-dialog{max-width:850px!important;max-height:90vh;overflow:auto;color:var(--ui-text-primary)}.am-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.am-detail-grid img{width:100%;border-radius:8px}.am-prompt{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;border:1px solid var(--ui-stroke-secondary);border-radius:8px}.am-link{color:var(--ui-accent);overflow-wrap:anywhere}
.am-embed{height:calc(100vh - 260px);min-height:300px;border:1px solid var(--ui-stroke-secondary);border-radius:10px;overflow:hidden;margin-top:18px}.am-workshop{border:1px solid var(--ui-stroke-secondary);border-radius:12px;padding:24px;max-width:780px}.am-path{overflow-wrap:anywhere;font-size:12px}.am-detail-tags{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}
@container(max-width:600px){.am-wrap{padding:20px 16px 36px}.am h1{font-size:26px}.am-top{align-items:flex-start;margin-bottom:18px}.am-detail-grid{grid-template-columns:1fr}.am-grid{gap:14px}.am-top>.am-actions{width:100%}}
@media(max-width:600px){.am-detail-grid{grid-template-columns:1fr}.am-dialog{max-width:calc(100vw - 24px)!important}}
`
function action(label, onClick, props = {}) { return jsx(Button, { size: 'sm', variant: 'outline', ...props, onClick, children: label }, label) }
function chip(label, selected, onClick, key = label) { return jsx('button', { type: 'button', className: 'am-chip', 'aria-pressed': selected, onClick, children: label }, key) }
function Thumbnail({ figure }) {
  const [broken, setBroken] = useState(false)
  return broken ? jsx('div', { className: 'am-placeholder', children: 'Thumbnail unavailable · open details' }) : jsx('img', { className: 'am-image', src: figure.image, alt: figure.title, loading: 'lazy', referrerPolicy: 'no-referrer', onError: () => setBroken(true) })
}
function Detail({ figure, onClose, prefs, save, toggleFavorite, play, external }) {
  return jsx(Dialog, { open: Boolean(figure), onOpenChange: open => { if (!open) onClose() }, children: figure ? jsxs(DialogContent, { className: 'am-dialog', children: [
    jsx('style', { children: CSS }),
    jsxs(DialogHeader, { children: [jsx(DialogTitle, { children: figure.title }), jsx(DialogDescription, { children: `By @${figure.author} · ${figure.kind} · ${figure.license}` })] }),
    jsxs('div', { className: 'am-detail-grid', children: [jsx(Thumbnail, { figure }), jsxs('div', { children: [jsx('div', { className: 'am-kicker', children: 'Original prompt' }), jsx('p', { className: 'am-prompt', children: figure.prompt }), jsxs('div', { className: 'am-detail-tags', children: figure.tags.map(tag => chip(tag, prefs.tag === tag, () => { save({ tag }); onClose() }, tag)) })] })] }),
    jsxs('div', { className: 'am-actions', children: [action('Open figure in Hermes', () => { onClose(); play(figure) }), action('Open externally', () => external(figure.website)), action('View source', () => external(figure.source)), action(prefs.favorites.includes(figure.key) ? 'Unfavorite' : 'Favorite', () => toggleFavorite(figure))] }),
    jsx('a', { className: 'am-link am-path', href: figure.source, onClick: event => { event.preventDefault(); external(figure.source) }, children: figure.source }),
    jsx('p', { className: 'am-small', children: `Community provenance: ${figure.key}. Catalog revision ${figure.sha.slice(0, 12)}. Source revision is pinned to the build's main commit; the website's interactive copy may update independently.` }),
    jsx('p', { className: 'am-small', children: figure.license === 'CC-BY-4.0' ? 'CC BY 4.0 · retain author credit and indicate changes. No changes made to this figure.' : 'MIT · retain the original author copyright and license notice when copying source.' }),
    jsx('a', { className: 'am-link', href: figure.license === 'CC-BY-4.0' ? 'https://creativecommons.org/licenses/by/4.0/' : 'https://opensource.org/license/mit', target: '_blank', rel: 'noopener noreferrer', onClick: event => { event.preventDefault(); external(event.currentTarget.href) }, children: 'License terms' })
  ] }) : null })
}
export const FIGURE_LICENSE = "MIT License\n\nCopyright (c) 2026 Ryan and the Anatomy figure contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n\nFigures licensed CC-BY-4.0 in their figure.json are under that license instead.\n"
function FigurePlayer({ figure, current, external }) {
  const [attempt, setAttempt] = useState(0)
  const alive = useRef(false)
  const generation = useRef(attempt)
  generation.current = attempt
  const active = () => alive.current && generation.current === attempt && current()
  const [document, setDocument] = useState(null)
  const [status, setStatus] = useState('Loading licensed standalone figure…')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    alive.current = true
    setDocument(null); setFailed(false); setStatus('Loading licensed standalone figure…')
    void loadStandalone(figure, { signal: controller.signal }).then(result => {
      if (mounted && current() && !controller.signal.aborted) { setDocument(result); setStatus('Starting isolated figure…') }
    }).catch(error => {
      if (mounted && current() && !controller.signal.aborted) { setFailed(true); setStatus(`Figure could not be loaded: ${String(error.message).slice(0, 220)}`) }
    })
    return () => { mounted = false; alive.current = false; controller.abort() }
  }, [figure, attempt])
  useEffect(() => {
    if (!document || document.loaded) return
    const timer = setTimeout(() => { if (active()) { setFailed(true); setStatus('No document load signal received. The figure may be blocked; retry or open externally.') } }, 15000)
    return () => clearTimeout(timer)
  }, [document])
  return jsxs('article', { children: [
    jsx('h2', { children: figure.title }),
    jsx('p', { className: 'am-muted', children: `By @${figure.author} · ${figure.license} · Anatomy by Ryan / wheresryan22` }),
    jsx('p', { role: 'status', className: failed ? 'am-warning' : 'am-muted', children: status }),
    jsx('p', { className: 'am-small', children: 'Official CI standalone page, unchanged. Executable community content runs only in an opaque-origin sandbox, not the Hermes plugin. A document load signal does not verify drawing or controls; if blank or broken, use external recovery. Nothing is saved to disk by this viewer.' }),
    jsx('p', { className: 'am-small am-path', children: `Figure ${figure.key} · catalog revision ${figure.sha} · source ${figure.source}` }),
    jsx('a', { className: 'am-link am-path', href: figure.rawLive, onClick: event => { event.preventDefault(); external(figure.rawLive) }, children: figure.rawLive }),
    jsxs('div', { className: 'am-actions', children: [action('Retry figure', () => { if (active()) { setDocument(null); setStatus('Loading licensed standalone figure…'); setFailed(false); setAttempt(value => value + 1) } }), action('View source', () => external(figure.source))] }),
    jsxs('details', { children: [jsx('summary', { children: 'Original figure license / copyright' }), jsx('pre', { className: 'am-prompt', children: figure.license === 'MIT' ? FIGURE_LICENSE : 'CC BY 4.0 · '+figure.key+' · https://creativecommons.org/licenses/by/4.0/ · No changes made to the figure. Source and revision above.' })] }),
    document && !failed ? jsx('div', { className: 'am-embed', children: jsx(SandboxedFrame, { src: document.src, title: `${figure.title} — standalone ${figure.key}`, sandbox: 'allow-scripts', style: { width: '100%', height: '100%', border: 0 }, onLoad: () => { if (active()) { setStatus('Document loaded in isolation — drawing and controls are not automatically verified.'); setDocument(value => value?.loaded ? value : { ...value, loaded: true }) } }, onError: () => { if (active()) { setFailed(true); setStatus('Isolated figure load failed. Retry or open externally.') } } }, `${figure.key}:${attempt}`) }) : null
  ] })
}

export function Museum({ ctx, paneId = null }) {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const owner = scopeKey(connectionId, profile)
  return owner ? jsx(OwnedMuseum, { ctx, owner, paneId }, owner) : jsxs('div', { className: 'am am-wrap', children: [jsx('style', { children: CSS }), jsx('h1', { children: 'Anatomy Museum' }), jsx('p', { children: 'Connection/profile ownership is unresolved. Connect Hermes before loading the museum or saving local preferences.' })] })
}
function OwnedMuseum({ ctx, owner, paneId }) {
  const visible = useValue(host.paneVisibility(paneId || 'workspace'))
  const [prefs, setPrefs] = useState(() => preferences(ctx.storage.get(`prefs:${owner}`, EMPTY)))
  const [tab, setTab] = useState('community')
  const [localPath, setLocalPath] = useState('')
  const [detail, setDetail] = useState(null)
  const [browser, setBrowser] = useState(null)
  const [notice, setNotice] = useState('')
  const [allSubjects, setAllSubjects] = useState(false)
  const key = [ID, owner, 'catalog-v2']
  const current = () => scopeKey(host.state.connectionId.get(), host.state.profile.get()) === owner
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => loadCatalog({ signal }), enabled: visible && tab === 'community', retry: false, staleTime: Infinity, gcTime: 30 * 60 * 1000, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  useEffect(() => {
    if (!visible || tab !== 'community') void queryClient.cancelQueries({ queryKey: key, predicate: q => !q.isActive() })
    if (!visible) setBrowser(null)
    // React Query aborts its consumed signal when the LAST observer unmounts.
    // Do not cancel a shared catalog still used by another visible museum tab.
  }, [visible, owner, tab])
  function save(patch) {
    if (!current()) return
    // Read the scoped source now, not a render closure; rapid favorite clicks are safe.
    try {
      const next = preferences({ ...preferences(ctx.storage.get(`prefs:${owner}`, EMPTY)), ...patch })
      ctx.storage.set(`prefs:${owner}`, next)
      setPrefs(next)
    } catch { setNotice('Local preference storage is unavailable. Nothing was uploaded; changes were not saved.') }
  }
  function favorite(row) {
    if (!current()) return
    const saved = preferences(ctx.storage.get(`prefs:${owner}`, EMPTY))
    save({ favorites: saved.favorites.includes(row.key) ? saved.favorites.filter(key => key !== row.key) : [...saved.favorites, row.key] })
  }
  function browse(url, title) {
    if (!current()) return
    try { setBrowser({ url: safeUrl(url), title }); setDetail(null) } catch { setNotice('Unsafe browsing destination refused.') }
  }
  function play(figure) {
    if (!current()) return
    try { standaloneUrl(figure); setBrowser({ figure, url: figure.website, title: figure.title }); setDetail(null) }
    catch { setNotice('Invalid standalone figure provenance refused.') }
  }
  async function external(url) {
    if (!current()) return
    try {
      const ok = await ctx.os.openExternal(safeUrl(url))
      if (current() && !ok) setNotice('External browser unavailable. Copy the visible source URL from details or README.')
    } catch { if (current()) setNotice('Could not open the external browser.') }
  }
  const catalog = query.data
  const figures = selectFigures(catalog, prefs)
  const tags = subjectTags(catalog?.figures || [])
  const shownTags = allSubjects ? tags : tags.filter(([tag], index) => index < 8 || tag === prefs.tag)
  const filtered = Boolean(prefs.query || prefs.tag || prefs.kind || prefs.favoritesOnly)
  return jsxs('section', { className: 'am', 'aria-label': 'Anatomy Museum', children: [jsx('style', { children: CSS }), jsxs('div', { className: 'am-wrap', children: [
    jsxs('header', { className: 'am-top', children: [jsxs('div', { children: [jsx('div', { className: 'am-kicker', children: 'A community collection · made with Anatomy' }), jsx('h1', { children: 'Ideas, built into machines.' }), jsx('p', { className: 'am-muted', children: 'Explore Ryan’s Anatomy community. Every figure keeps its maker and original prompt.' })] }), jsxs('div', { className: 'am-actions', children: [action("Browse Ryan’s website", () => browse(SITE, 'Anatomy community')), action('External website', () => external(SITE))] })] }),
    jsxs('nav', { className: 'am-filters', 'aria-label': 'Museum sections', children: [chip('Community', tab === 'community', () => { setTab('community'); setBrowser(null) }), chip('My workshop', tab === 'workshop', () => { setTab('workshop'); setBrowser(null) })] }),
    notice ? jsx('p', { role: 'alert', className: 'am-warning', children: notice }) : null,
    browser ? jsxs('div', { children: [jsxs('div', { className: 'am-actions', children: [action('Back to collection', () => setBrowser(null)), action('Open externally', () => external(browser.url))] }), browser.figure ? jsx(FigurePlayer, { figure: browser.figure, current, external }, `${owner}:${browser.figure.key}`) : jsxs('div', { children: [jsx('h2', { children: browser.title }), jsx('p', { className: 'am-muted', children: 'Isolated website preview — no cookies, popups, downloads or access to Hermes. If the site is blank, blocked or needs browser storage, use Open externally. Website wrapper Play-with-it is NOT supported here: website live pages restrict framing, and opaque-origin client navigation/prefetch can fail. Use Open figure in Hermes from the collection for licensed standalone play, or Open externally for full website browsing. Loading a heading is not interactive success.' }), jsx('p', { className: 'am-small am-path', children: browser.url }), jsx('div', { className: 'am-embed', children: jsx(SandboxedFrame, { src: browser.url, title: browser.title, sandbox: 'allow-scripts', style: { width: '100%', height: '100%', border: 0 } }) })] })] }) : tab === 'workshop' ? jsxs('article', { className: 'am-workshop', children: [jsx('div', { className: 'am-kicker', children: 'Local · separate from public results' }), jsx('h2', { children: 'My workshop' }), jsx('p', { className: 'am-muted', children: 'No local creation is configured. Enter an absolute file path on this Desktop computer to reveal your own instrument in its original location. This does not open or execute it; nothing is uploaded.' }), jsx(SearchField, { value: localPath, onChange: setLocalPath, placeholder: 'Absolute local file path', 'aria-label': 'Local workshop path' }), action('Reveal local creation', async () => { const path = workshopPath(localPath); if (current() && path) { try { const ok = await ctx.os.revealPath(path); if (current() && !ok) setNotice('Reveal is unavailable or the path does not exist on this Desktop computer.') } catch { if (current()) setNotice('Could not reveal this local path.') } } }, { disabled: !workshopPath(localPath) }), jsx('p', { className: 'am-small', children: 'Optional and user-supplied; reset when this page closes. Paths belong to the frontend computer, not a connected remote host. No local source is copied, read by this plugin or added to public results.' })] }) : jsxs('div', { children: [
      jsxs('div', { className: 'am-toolbar', children: [jsx(SearchField, { value: prefs.query, onChange: value => save({ query: value }), placeholder: 'Search titles, full prompts and tags', 'aria-label': 'Search figures', containerClassName: 'am-search' }), action(prefs.favoritesOnly ? 'All figures' : `Favorites (${prefs.favorites.length})`, () => save({ favoritesOnly: !prefs.favoritesOnly }), { 'aria-pressed': prefs.favoritesOnly }), action(query.isFetching ? 'Refreshing…' : 'Refresh', () => { if (current() && !query.isFetching) void query.refetch() }, { disabled: query.isFetching }), filtered ? action('Clear filters', () => save({ query: '', tag: '', kind: '', favoritesOnly: false })) : null] }),
      jsxs('div', { className: 'am-filters', 'aria-label': 'Rendering kind', children: [jsx('span', { className: 'am-label', children: 'Rendering' }), chip('All kinds', !prefs.kind, () => save({ kind: '' })), ...[['svg', 'SVG'], ['webgl', 'WebGL'], ['3d', '3D']].map(([kind, label]) => chip(label, prefs.kind === kind, () => save({ kind }), kind))] }),
      jsxs('div', { className: 'am-filters', 'aria-label': 'Subject tags', children: [jsx('span', { className: 'am-label', children: 'Subjects · author tags' }), chip('All subjects', !prefs.tag, () => save({ tag: '' })), ...shownTags.map(([tag, count]) => chip(`${tag} · ${count}`, prefs.tag === tag, () => save({ tag: prefs.tag === tag ? '' : tag }), tag)), tags.length > 8 ? action(allSubjects ? 'Fewer subjects' : `All ${tags.length} subjects`, () => setAllSubjects(!allSubjects)) : null] }),
      query.isError ? jsxs('div', { role: 'alert', className: 'am-warning', children: [jsx('strong', { children: catalog ? 'Refresh failed — showing last-good data.' : 'Collection could not be loaded.' }), jsx('p', { children: 'Network, rate limit or catalog validation failed. Use Refresh to retry. A failed fetch is not an empty collection.' }), jsx('p', { className: 'am-small', children: String(query.error?.message || 'Unknown fetch failure').slice(0, 200) })] }) : null,
      jsxs('div', { className: 'am-status', role: 'status', children: [jsx('span', { className: 'am-muted', children: query.isPending && !catalog ? 'Loading community catalog…' : resultLabel(catalog, figures.length, filtered) }), catalog ? jsx('span', { className: 'am-small', children: `${query.isError ? 'Stale · ' : ''}Feed ${catalog.updated.slice(0, 10)} · ${catalog.sha.slice(0, 8)}` }) : null] }),
      catalog ? figures.length ? jsx('div', { className: 'am-grid', children: figures.map(row => jsxs('article', { className: 'am-card', children: [jsxs('button', { type: 'button', className: 'am-card-open', onClick: () => { if (current()) setDetail(row) }, 'aria-label': `Details: ${row.title}`, children: [jsx(Thumbnail, { figure: row }), jsxs('div', { className: 'am-body', children: [jsx('div', { className: 'am-title', children: row.title }), jsx('div', { className: 'am-small', children: `@${row.author} · ${row.license}` }), jsx('div', { className: 'am-snippet', children: row.prompt })] })] }), jsxs('div', { className: 'am-card-foot', children: [jsx('span', { className: 'am-kind', children: row.kind }), action(prefs.favorites.includes(row.key) ? '★ Saved' : '☆ Save', () => favorite(row), { 'aria-label': `Favorite ${row.title}`, 'aria-pressed': prefs.favorites.includes(row.key) })] })] }, row.key)) }) : jsxs('div', { className: 'am-empty', children: [jsx('h2', { children: resultLabel(catalog, 0, filtered) }), jsx('p', { className: 'am-muted', children: 'No figure is generated automatically. Change the query or clear filters.' }), prefs.query && tags.length ? jsxs('div', { className: 'am-filters', children: [jsx('span', { className: 'am-label', children: 'Suggestions — not matches' }), ...tags.slice(0, 5).map(([tag]) => chip(tag, false, () => save({ query: '', tag }), tag))] }) : null] }) : null,
      jsx('p', { className: 'am-small', children: 'Anatomy by Ryan / wheresryan22. Figures remain credited to their authors. Loads on demand; Refresh is manual. Favorites and filters stay on this Desktop, scoped to connection and profile. Interactive figures are executable community content and run only in the isolated preview.' })
    ] })
  ] }), jsx(Detail, { figure: detail, onClose: () => setDetail(null), prefs, save, toggleFavorite: favorite, play, external })] })
}
export default {
  id: ID, name: 'Anatomy Museum', description: 'On-demand Anatomy community gallery, search and local favorites.', defaultEnabled: false,
  register(ctx) {
    if (typeof host.openWorkspace !== 'function' || typeof host.paneVisibility !== 'function' || typeof ctx.onDispose !== 'function' || !SandboxedFrame) {
      host.notify({ kind: 'error', message: 'Anatomy Museum needs the current Desktop SDK: openWorkspace, paneVisibility, SandboxedFrame and onDispose.' })
      return
    }
    let close = null
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: '/anatomy-museum' }, render: () => jsx(Museum, { ctx }) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/anatomy-museum', label: 'Anatomy Museum', codicon: 'library' } })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'anatomy-museum.open', label: 'Open Anatomy Museum', keywords: ['anatomy', 'museum', 'community', 'figures'], run: () => { close = host.openWorkspace(ID, { title: 'Anatomy Museum', render: () => jsx(Museum, { ctx, paneId: `plugin-workspace:${ID}` }), onClose: () => { close = null } }) } } })
    ctx.onDispose(() => { close?.(); void queryClient.cancelQueries({ queryKey: [ID] }); queryClient.removeQueries({ queryKey: [ID] }) })
  }
}
