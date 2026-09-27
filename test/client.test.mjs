/**
 * Exercises the shipped browser bundle exactly as the DSH module loader does:
 * evaluate the classic script with a `window.__ModuleLoader__` facade, then call
 * the registered factory with a `require` that answers only the platform seed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SEED = '@deepseek-ai/dsh-client-ui-primitives'
const BUNDLE = new URL('../lib/client.js', import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))

let evaluation = 0

/** A stand-in for `React.memo(fn)`: a plain object whose `.type` is the renderer. */
function fakeMarkdownText() {
  const calls = []
  const inner = (props) => {
    calls.push(props)
    return props === null || props === undefined ? undefined : props.text
  }
  return { calls, inner, component: { $$typeof: Symbol.for('react.memo'), type: inner, compare: null } }
}

async function loadBundle(seed) {
  const registrations = []
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load: (registration) => {
        registrations.push(registration)
      }
    }
  }
  try {
    const url = new URL(BUNDLE)
    url.searchParams.set('evaluation', String(evaluation++))
    await import(url.href)
  } finally {
    globalThis.window = previousWindow
  }
  assert.equal(registrations.length, 1, 'the bundle registers exactly one module')
  const requested = []
  const require = (spec) => {
    requested.push(spec)
    if (spec !== SEED) throw new Error(`unexpected require(${JSON.stringify(spec)})`)
    if (seed === 'unavailable') throw new Error('seed unavailable')
    return seed
  }
  return { registration: registrations[0], exports: registrations[0].factory(require), requested }
}

function fakeContext() {
  const disposers = []
  return {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    dispose() {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }
}

test('registers under the package id, needs no services, requires only the seed', async () => {
  const { component } = fakeMarkdownText()
  const { registration, exports, requested } = await loadBundle({ MarkdownText: component })
  assert.equal(registration.id, 'dsh-tex-block-normalizer')
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, [])
  exports.apply(fakeContext())
  assert.deepEqual(requested, [SEED])
})

test('the patched component normalizes Pandoc-style text before the parser sees it', async () => {
  const { component, inner, calls } = fakeMarkdownText()
  const { exports } = await loadBundle({ MarkdownText: component })
  exports.apply(fakeContext())
  assert.notEqual(component.type, inner, 'the memo inner function is replaced')
  assert.equal(component.type({ text: '$$a = 1\nb = 2$$\n\nprose\n', labels: {} }), '$$\na = 1\nb = 2\n$$\n\nprose\n')
  const clean = { text: 'plain text', labels: {} }
  assert.equal(component.type(clean), 'plain text')
  assert.equal(calls.at(-1), clean, 'unchanged text keeps the identical props object')
  assert.deepEqual(globalThis.__DSH_TEX_BLOCK_NORMALIZER__, {
    installed: true,
    reason: 'installed',
    stats: { calls: 2, rewrites: 1 }
  })
})

test('props that are not a text object pass straight through', async () => {
  const { component, calls } = fakeMarkdownText()
  const { exports } = await loadBundle({ MarkdownText: component })
  exports.apply(fakeContext())
  assert.equal(component.type(null), undefined)
  assert.equal(calls.at(-1), null)
  assert.equal(component.type({ text: 42 }), 42, 'non-string text is left to the original component')
})

test('a second activation does not double-wrap', async () => {
  const { component } = fakeMarkdownText()
  const first = await loadBundle({ MarkdownText: component })
  first.exports.apply(fakeContext())
  const wrapped = component.type
  const second = await loadBundle({ MarkdownText: component })
  second.exports.apply(fakeContext())
  assert.equal(component.type, wrapped, 'still exactly one wrapper')
  assert.equal(globalThis.__DSH_TEX_BLOCK_NORMALIZER__.reason, 'already-installed')
})

test('dispose restores the original component', async () => {
  const { component, inner } = fakeMarkdownText()
  const { exports } = await loadBundle({ MarkdownText: component })
  const ctx = fakeContext()
  exports.apply(ctx)
  assert.notEqual(component.type, inner)
  ctx.dispose()
  assert.equal(component.type, inner)
  assert.equal(component.type({ text: '$$a = 1\nb = 2$$\n' }), '$$a = 1\nb = 2$$\n', 'no normalization after dispose')
  assert.equal(globalThis.__DSH_TEX_BLOCK_NORMALIZER__.reason, 'disposed')
})

test('an unknown MarkdownText shape degrades to a no-op', async () => {
  const { exports } = await loadBundle({ MarkdownText: { notAComponent: true } })
  const ctx = fakeContext()
  exports.apply(ctx)
  assert.deepEqual(globalThis.__DSH_TEX_BLOCK_NORMALIZER__, { installed: false, reason: 'markdown-text-shape-unknown' })
  ctx.dispose()
})

test('an unavailable seed degrades to a no-op', async () => {
  const { exports } = await loadBundle('unavailable')
  exports.apply(fakeContext())
  assert.equal(globalThis.__DSH_TEX_BLOCK_NORMALIZER__.installed, false)
  assert.equal(globalThis.__DSH_TEX_BLOCK_NORMALIZER__.reason, 'seed-unavailable')
})

test('the disable flag keeps the component untouched', async () => {
  const { component, inner } = fakeMarkdownText()
  globalThis.__DSH_TEX_BLOCK_NORMALIZER_DISABLE__ = true
  try {
    const { exports } = await loadBundle({ MarkdownText: component })
    exports.apply(fakeContext())
    assert.equal(component.type, inner)
    assert.deepEqual(globalThis.__DSH_TEX_BLOCK_NORMALIZER__, { installed: false, reason: 'disabled' })
  } finally {
    delete globalThis.__DSH_TEX_BLOCK_NORMALIZER_DISABLE__
  }
})

test('lib/client.js is a self-contained classic script', () => {
  const source = readFileSync(BUNDLE, 'utf8')
  assert.ok(source.includes('window.__ModuleLoader__.load({'))
  assert.ok(!/^\s*(import|export)\s/m.test(source), 'no ESM statements: the loader serves this file verbatim')
  assert.ok(source.includes("src.includes('$$')"), 'the embedded normalizer kept its $$ literals intact')
  assert.ok(source.includes('\\$\\$'), 'the embedded delimiter regex kept both dollars')
})

test('lib/client.js is in sync with lib/normalize.js', () => {
  execFileSync(process.execPath, ['scripts/build-client.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' })
})
