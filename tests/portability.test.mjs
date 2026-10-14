import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadModule } from './load-module.mjs'
const m = await loadModule()
test('workshop starts unconfigured and only accepts explicit frontend-local absolute paths', async () => {
  for (const value of ['', null, 'relative/index.html', '~/index.html', 'https://example.org', 'file:///example', '//server/share', '/a\nsecret', 'a'.repeat(4097)]) assert.equal(m.workshopPath(value), null)
  for (const value of ['/example/instrument/index.html', 'C:\\Workshop\\index.html']) assert.equal(m.workshopPath(value), value)
  const source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  assert.ok(source.includes("const [localPath, setLocalPath] = useState('')"))
  assert.ok(!source.includes('/Users/'))
})
