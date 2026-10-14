import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from './load-module.mjs'
const m = await loadModule()
const sha = 'a'.repeat(40)
const f = { author: 'Author', id: 'figure', key: 'Author/figure', assetSlug: 'author/figure', sha, license: 'MIT', rawLive: `https://raw.githubusercontent.com/wheresryan22/anatomy-community/${sha}/live/author/figure.html`, source: `https://github.com/wheresryan22/anatomy-community/tree/${sha}/figures/author/figure` }
const html = '<!doctype html><title>Unicode π</title><script>window.guest=true</script>'
const response = (body=html,headers={}) => new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })
test('standalone exact immutable identity, license and provenance fail before fetching', async () => {
  for (const patch of [{sha:'previews'}, {sha:'A'.repeat(40)}, {key:'author/figure'}, {assetSlug:'Author/figure'}, {license:'unknown'}, {rawLive:f.rawLive+'?x'}, {rawLive:f.rawLive.replace(sha,'previews')}, {source:f.source.replace('/author/','/Author/')}]) {
    let calls=0; await assert.rejects(m.loadStandalone({...f,...patch},{fetcher:()=>{calls++; return response()}})); assert.equal(calls,0)
  }
})
test('standalone stream preserves UTF8 and guest scripts as unchanged inert text; private cache off',async()=>{
 let options
 const result=await m.loadStandalone(f,{fetcher:async(url,opts)=>{assert.equal(url,f.rawLive); options=opts; return response()}})
 assert.equal(decodeURIComponent(result.src.split(',').slice(1).join(',')),html)
 assert.equal(result.bytes,Buffer.byteLength(html)); assert.equal(globalThis.guest,undefined)
 assert.equal(options.cache,'no-store'); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error'); assert.equal(options.referrerPolicy,'no-referrer')
})
test('standalone MIME/UTF8/HTML policy refuses unsafe, non-standalone and malformed responses',async()=>{
 for(const r of [response(html,{'content-type':'application/javascript'}),response(html,{'content-type':'text/plain'}),response(html,{'content-type':'text/html; charset=latin1'}),response(new Uint8Array([255])),response('not HTML'),response('<!doctype html>\0'),response('<!doctype html><script src="https://evil.example"></script>'),response('<!doctype html><iframe></iframe>'),response('<!doctype html><link href="https://evil.example">'),new Response('failure',{status:403})]) await assert.rejects(m.loadStandalone(f,{fetcher:async()=>r}))
 const redirected=response(); Object.defineProperty(redirected,'url',{value:f.rawLive.replace(sha,'b'.repeat(40))}); await assert.rejects(m.loadStandalone(f,{fetcher:async()=>redirected}),/identity changed/)
})
test('4MiB limit enforced both declared and streaming; reader canceled',async()=>{
 await assert.rejects(m.loadStandalone(f,{fetcher:async()=>response(html,{'content-length':String(m.LIVE_MAX_BYTES+1)})}),/limit/)
 let canceled=false
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(m.LIVE_MAX_BYTES)); c.enqueue(new Uint8Array(1))},cancel(){canceled=true}})
 await assert.rejects(m.loadStandalone(f,{fetcher:async()=>response(stream)}),/limit/); assert.equal(canceled,true)
})
test('header/MIME rejection cancels unread body without starting download', async () => {
 for (const headers of [{ 'content-type':'application/javascript' }, { 'content-length': String(m.LIVE_MAX_BYTES + 1) }]) {
  let canceled = false
  const body = new ReadableStream({ cancel() { canceled = true } })
  await assert.rejects(m.loadStandalone(f, { fetcher: async () => response(body, headers) }))
  assert.equal(canceled, true)
 }
})
test('timeout cancels stalled streaming reader; preabort fetches nothing; mount cancel rejects',async()=>{
 for (const manual of [false,true]) {
  let canceled=false
  const c=new AbortController()
  const result=m.loadStandalone(f,{signal:c.signal,timeoutMs:manual?1000:10,fetcher:async()=>response(new ReadableStream({cancel(){canceled=true}}))})
  if(manual)setTimeout(()=>c.abort(),10)
  await assert.rejects(result,{name:'AbortError'}); assert.equal(canceled,true)
 }
 const c=new AbortController();c.abort();let called=false
 await assert.rejects(m.loadStandalone(f,{signal:c.signal,fetcher:async()=>{called=true;return response()}}),{name:'AbortError'}); assert.equal(called,false)
})
