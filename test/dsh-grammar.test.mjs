/**
 * Acceptance test: parse the fixture with the exact grammar the DSH GUI uses
 * (see scripts/dsh-grammar.mjs) and typeset every display formula with KaTeX.
 *
 * The raw fixture must reproduce the failure; the normalized fixture must parse
 * clean. Skipped when the dev-only parser dependencies are not installed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeTexBlocks } from '../lib/normalize.js'

const fixture = readFileSync(new URL('../fixtures/pandoc-style-message.md', import.meta.url), 'utf8')

let grammar
let skip
try {
  grammar = await import('../scripts/dsh-grammar.mjs')
} catch (error) {
  skip = `devDependencies unavailable (${error.code ?? error.message}) — run: npm install`
}

test('raw fixture reproduces the DSH failure', { skip }, () => {
  const result = grammar.audit(fixture)
  const textLines = fixture.trimEnd().split('\n')
  assert.equal(result.nodes.length, 1, 'every later block is swallowed into one math node')
  assert.equal(
    result.nodes[0].node.position.start.line,
    textLines.findIndex((line) => line.startsWith('$$')) + 1
  )
  assert.equal(result.nodes[0].node.position.end.line, fixture.split('\n').length, 'the node runs to the document end')
  assert.match(result.nodes[0].verdict, /KaTeX parse error/, 'and KaTeX rejects it')
  assert.ok(result.nodes[0].node.value.includes('## 二、对照表'), 'the swallowed run includes prose and the table heading')
})

test('normalized fixture parses clean under the DSH grammar', { skip }, () => {
  const result = grammar.audit(normalizeTexBlocks(fixture))
  assert.equal(result.nodes.length, 3, 'three display blocks survive as three math nodes')
  assert.equal(result.failures, 0)
  const values = result.nodes.map((entry) => entry.node.value)
  assert.ok(values[0].startsWith('\\frac{\\partial}'), 'the first line is no longer dropped as meta')
  assert.ok(values[0].includes('因子）'), 'and the closing line is part of the formula')
  assert.ok(values[1].includes('\\bm{dx}_1^{(i)}'), 'the multi-line block keeps its last line')
  assert.equal(values[2], '\\bm{dx} = \\sum_i \\bm{dx}^{(i)}')
  assert.ok(!values.some((value) => value.includes('## 二、对照表')), 'no prose leaks into math')
})
