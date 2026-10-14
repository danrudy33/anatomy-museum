import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from './load-module.mjs'
import { readFile } from 'node:fs/promises'
const mixedCaseDetails = await Promise.all(['daniel-detail', 'nuzairb-detail'].map(name => readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)))
const registrations = [], disposers = [], calls = []
const sdk = { host: { openWorkspace: (id, options) => { calls.push([id, options]); return () => calls.push(['closed']) }, paneVisibility: () => {}, notify: () => {} }, queryClient: { cancelQueries: opts => calls.push(['cancel', opts]), removeQueries: opts => calls.push(['remove', opts]) }, SandboxedFrame: () => {}, ROUTES_AREA: 'routes', SIDEBAR_NAV_AREA: 'nav', PALETTE_AREA: 'palette' }
const m = await loadModule(sdk)
const sha = 'a'.repeat(40), main = 'b'.repeat(40)
function row(n = 0) { return { id: `test-${n}`, author: 'Author', title: `Figure ${n}`, snippet: 'Short prompt', prompt: 'Full prompt with hidden tail and hydraulic learning', kind: 'SVG', tags: ['mechanism', 'learning'], image: `cards/author/test-${n}.webp`, license: 'MIT', live: `live/author/test-${n}.html`, source: `figures/author/test-${n}` } }
const index = { version: 2, updated: '2026-10-13T00:00:00Z', total: 3, perPage: 2, pages: 2 }
function fixture({ total = 3, change = () => {}, failure = '' } = {}) {
  const requested = []
  const fetcher = async url => {
    requested.push(url)
    if (url.includes(failure) && failure) return new Response('failed', { status: 503 })
    let data
    if (url.includes('/branches/')) data = { commit: { sha } }
    else if (url.includes('index.json')) data = { ...index, total, pages: Math.ceil(total / 2) }
    else if (url.includes('/contents/')) data = { encoding: 'base64', content: Buffer.from(main + '\n').toString('base64') }
    else if (url.includes('/feed/page-')) { const page = Number(url.match(/page-(\d+)/)[1]); data = { page, pages: Math.ceil(total / 2), figures: Array.from({ length: Math.min(2, total - (page - 1) * 2) }, (_, i) => row((page - 1) * 2 + i)) } }
    else if (url.includes('/feed/figures/')) data = row(Number(url.match(/test-(\d+)/)[1]))
    else throw Error('Unexpected fixture URL')
    change(data, url)
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
  }
  return { fetcher, requested }
}
test('index schema, timestamps and pagination fail closed', () => {
  assert.deepEqual(m.validateIndex(index), { total: 3, perPage: 2, pages: 2, updated: index.updated })
  for (const bad of [{ version: 3 }, { total: -1 }, { total: '3' }, { pages: 1 }, { perPage: 0 }, { perPage: 49 }, { updated: 'unknown' }]) assert.throws(() => m.validateIndex({ ...index, ...bad }))
})
test('source-qualified identity preserves author case and disallows traversal', () => {
  assert.equal(m.identity(row()), 'Author/test-0')
  for (const bad of ['../x', '/test', 'a%2fb', '<img>', '', 'a_b']) assert.throws(() => m.identity({ ...row(), id: bad }))
  assert.throws(() => m.validateFigure(row(), sha, 'Someone/test-0', true))
})
test('real mixed-case authors keep attribution/identity while only asset author slug is canonicalized', () => {
  for (const raw of mixedCaseDetails) {
    const key = `${raw.author}/${raw.id}`, assetSlug = `${raw.author.toLowerCase()}/${raw.id}`
    const full = m.validateFigure(raw, sha, key, true)
    assert.equal(full.author, raw.author); assert.equal(full.id, raw.id); assert.equal(full.key, key)
    assert.equal(full.assetSlug, assetSlug)
    assert.equal(full.image, `https://raw.githubusercontent.com/wheresryan22/anatomy-community/${sha}/${raw.image}`)
    assert.equal(full.rawLive, `https://raw.githubusercontent.com/wheresryan22/anatomy-community/${sha}/${raw.live}`)
    assert.equal(full.live, `https://skills.wheresryan.sh/anatomy/media/community/${raw.live}`)
    assert.equal(full.source, `https://github.com/wheresryan22/anatomy-community/tree/${sha}/${raw.source}`)
    assert.equal(full.website, `${m.SITE}/${assetSlug}`)
    assert.equal(m.validateFigure({ ...raw, image: `previews/${assetSlug}.webp` }, sha).assetSlug, assetSlug)
    for (const change of [{ image: `cards/${key}.webp` }, { live: `live/${key}.html` }, { source: `figures/${key}` }, { id: raw.id.toUpperCase() }, { author: raw.author.toLowerCase() }]) assert.throws(() => m.validateFigure({ ...raw, ...change }, sha, key, true))
    assert.throws(() => m.validateFigure({ ...raw, author: `${raw.author}/..` }, sha))
  }
})
test('loader requests lowercase detail/source paths but rejects canonical case-collision duplicates', async () => {
  const f = fixture(), catalog = await m.loadCatalog(f)
  assert.ok(f.requested.filter(url => url.includes('/feed/figures/')).every(url => url.includes('/feed/figures/author/')))
  assert.ok(catalog.figures.every(row => row.source === `https://github.com/wheresryan22/anatomy-community/tree/${main}/figures/${row.assetSlug}`))
  await assert.rejects(m.loadCatalog(fixture({ change: (data, url) => { if (url.includes('page-1')) data.figures[1] = { ...row(0), author: 'author' } } })), /Duplicate catalog identity/)
})
test('safe URLs reject local, scripted, credentialed, ports and foreign hosts', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/x', 'data:text/html,a', 'https://evil.example/a', 'https://github.com.evil.example', 'https://a@github.com/x', 'https://github.com:4433/x', '//github.com/x', 'http://github.com']) assert.throws(() => m.safeUrl(url))
  assert.equal(m.safeUrl('https://github.com/wheresryan22'), 'https://github.com/wheresryan22')
})
test('full prompt, license and exact provenance paths validated; hostile text remains inert data', () => {
  const hostile = '<img src=x onerror=alert(1)>'
  const full = m.validateFigure({ ...row(), title: hostile, prompt: hostile }, sha, undefined, true)
  assert.equal(full.prompt, hostile)
  for (const change of [{ license: 'unknown' }, { kind: 'video' }, { live: 'https://evil.test' }, { image: '../secret.webp' }, { source: 'figures/Other/test-0' }, { tags: ['javascript:'] }, { prompt: 'x'.repeat(16001) }]) assert.throws(() => m.validateFigure({ ...row(), ...change }, sha, undefined, true))
})
test('immutable snapshot loads all pages and full details; count verified', async () => {
  const f = fixture()
  const catalog = await m.loadCatalog(f)
  assert.equal(catalog.figures.length, 3); assert.equal(catalog.total, 3); assert.equal(catalog.complete, true)
  assert.equal(catalog.sourceSha, main); assert.ok(catalog.figures[0].source.includes(main))
  assert.ok(f.requested.slice(1).every(url => url.includes(sha)))
  assert.equal(f.requested.filter(url => url.includes('feed/page-')).length, 2)
})
test('duplicate, missing, inconsistent pages, details and revisions are rejected', async () => {
  for (const change of [
    (data, url) => { if (url.includes('page-2')) data.figures = [] },
    (data, url) => { if (url.includes('page-2')) data.figures = [row(0)] },
    (data, url) => { if (url.includes('page-1')) data.pages = 9 },
    (data, url) => { if (url.includes('feed/figures')) data.title = 'changed' },
    (data, url) => { if (url.includes('feed/figures')) data.author = 'Other' },
    (data, url) => { if (url.includes('feed/figures')) data.author = 'author' },
    (data, url) => { if (url.includes('feed/figures')) data.image = `previews/author/${data.id}.webp` },
    (data, url) => { if (url.includes('branches')) data.commit.sha = '../bad' },
    (data, url) => { if (url.includes('contents')) data.content = 'eA==' }
  ]) await assert.rejects(m.loadCatalog(fixture({ change })))
})
test('partial bounded catalog never claims verified zero; genuine empty does', async () => {
  const partial = await m.loadCatalog({ ...fixture({ total: 5 }), limit: 2 })
  assert.equal(partial.figures.length, 2); assert.equal(partial.complete, false)
  assert.match(m.resultLabel(partial, 0, true), /absence is not verified/)
  const empty = await m.loadCatalog(fixture({ total: 0 }))
  assert.equal(empty.complete, true); assert.equal(m.resultLabel(empty, 0, false), 'Verified empty collection')
})
test('failed refresh is an error, not an empty catalog', async () => {
  const good = await m.loadCatalog(fixture())
  await assert.rejects(m.loadCatalog(fixture({ failure: 'feed/page-2' })), /HTTP 503/)
  assert.equal(good.figures.length, 3)
  await assert.rejects(m.loadCatalog(fixture({ failure: 'feed/figures' })), /HTTP 503/)
})
test('five-page ceiling applies even if upstream changes the page size', async () => {
  const f = fixture({ total: 12 })
  const catalog = await m.loadCatalog(f)
  assert.equal(catalog.figures.length, 10)
  assert.equal(catalog.complete, false)
  assert.equal(f.requested.filter(url => url.includes('feed/page-')).length, 5)
})
test('failed detail validation aborts outstanding sibling workers', async () => {
  const f = fixture(), aborted = []
  const fetcher = async (url, options) => {
    if (!url.includes('feed/figures')) return f.fetcher(url, options)
    if (url.includes('test-0')) return new Response(JSON.stringify({ ...row(), license: 'unsafe' }))
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { aborted.push(url); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  }
  await assert.rejects(m.loadCatalog({ fetcher }), /license/)
  assert.equal(aborted.length, 2)
})
test('streamed byte limits and invalid JSON/HTTP enforced', async () => {
  const url = 'https://github.com'
  await assert.rejects(m.boundedJson(url, { maxBytes: 5, fetcher: async () => new Response('1234567') }), /size limit/)
  await assert.rejects(m.boundedJson(url, { maxBytes: 5, fetcher: async () => new Response('{}', { headers: { 'content-length': '6' } }) }), /size limit/)
  await assert.rejects(m.boundedJson(url, { fetcher: async () => new Response('not json') }))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(m.boundedJson(url, { signal: controller.signal, fetcher: async (_, opts) => { opts.signal.throwIfAborted(); return new Response('{}') } }))
})
test('full prompt search is substring exact, tags/kinds/favorites intersect', () => {
  const figures = [m.validateFigure(row(0), sha, undefined, true), m.validateFigure({ ...row(1), kind: 'SVG + 3D' }, sha, undefined, true)]
  const catalog = { figures }
  assert.equal(m.selectFigures(catalog, m.preferences({ query: 'hidden tail' })).length, 2)
  assert.equal(m.selectFigures(catalog, m.preferences({ query: 'hiddden' })).length, 0)
  assert.equal(m.selectFigures(catalog, m.preferences({ tag: 'learning', kind: '3d' }))[0].id, 'test-1')
  assert.equal(m.selectFigures(catalog, m.preferences({ favoritesOnly: true, favorites: ['Author/test-0'] })).length, 1)
})
test('owner scopes distinct and unresolved owners do not default; malformed prefs bounded', () => {
  assert.notEqual(m.scopeKey('a', 'default'), m.scopeKey('b', 'default'))
  assert.notEqual(m.scopeKey('a', 'one'), m.scopeKey('a', 'two'))
  assert.equal(m.scopeKey(null, 'default'), null)
  assert.equal(m.preferences({ query: 'x'.repeat(250), favorites: ['../x', 'Author/test-0', 'Author/test-0'] }).query.length, 200)
  assert.deepEqual(m.preferences({ favorites: ['../x', 'Author/test-0', 'Author/test-0'] }).favorites, ['Author/test-0'])
})
test('native registration opt-in; opening is on demand and dispose closes workspace/cancels cache', () => {
  m.default.register({ register: c => registrations.push(c), onDispose: fn => disposers.push(fn) })
  assert.equal(m.default.defaultEnabled, false); assert.equal(registrations.length, 3); assert.equal(calls.length, 0)
  registrations.find(c => c.area === 'palette').data.run()
  assert.equal(calls[0][0], 'anatomy-museum')
  assert.equal(typeof calls[0][1].render, 'function')
  disposers[0]()
  assert.deepEqual(calls.slice(1).map(c => c[0]), ['closed', 'cancel', 'remove'])
})
