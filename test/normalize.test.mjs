/**
 * Pure-function tests for the display-math normalizer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeTexBlocks } from '../lib/normalize.js'

const fixture = readFileSync(new URL('../fixtures/pandoc-style-message.md', import.meta.url), 'utf8')

/**
 * The document's content as an ordered line sequence, ignoring blank lines and
 * ignoring the `$$` delimiters wherever they sit. Normalization may only move
 * delimiters, so this signature must be identical before and after.
 */
function contentSignature(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      let bare = line
      if (bare.startsWith('$$')) bare = bare.slice(2)
      if (bare.endsWith('$$')) bare = bare.slice(0, -2)
      return bare.trim()
    })
    .filter((line) => line !== '')
}

const standaloneDelimiters = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line === '$$')

test('fixture: the two Pandoc-style blocks become fences and nothing is lost', () => {
  const fixed = normalizeTexBlocks(fixture)
  assert.equal(fixed, normalizeTexBlocks(fixed), 'idempotent')
  assert.equal(standaloneDelimiters(fixed).length, 4, 'two rewritten blocks contribute four standalone $$ lines')
  assert.deepEqual(contentSignature(fixed), contentSignature(fixture), 'content preserved line for line')
  const dollarLines = fixed.split('\n').filter((line) => line.trim().startsWith('$$'))
  const singleLine = dollarLines.filter((line) => line.trim() !== '$$')
  assert.equal(singleLine.length, 1, 'only the authored single-line block keeps both delimiters on one line')
})

test('fixture: the already-single-line block is left alone', () => {
  const fixed = normalizeTexBlocks(fixture)
  assert.ok(fixed.includes('$$\\bm{dx} = \\sum_i \\bm{dx}^{(i)}$$'), 'shape 2 untouched')
})

test('delimiter shapes A-E', () => {
  const cases = [
    ['A both attached', '$$a = 1\nb = 2$$\n\nprose\n', '$$\na = 1\nb = 2\n$$\n\nprose\n'],
    ['B opening attached', '$$a = 1\nb = 2\n$$\n\nprose\n', '$$\na = 1\nb = 2\n$$\n\nprose\n'],
    ['C closing attached', '$$\na = 1\nb = 2$$\n\nprose\n', '$$\na = 1\nb = 2\n$$\n\nprose\n'],
    ['D already fenced', '$$\na = 1\nb = 2\n$$\n\nprose\n', '$$\na = 1\nb = 2\n$$\n\nprose\n'],
    ['E single line', '$$a = 1\\quad b = 2$$\n\nprose\n', '$$a = 1\\quad b = 2$$\n\nprose\n']
  ]
  for (const [label, input, expected] of cases) assert.equal(normalizeTexBlocks(input), expected, label)
})

test('code is never rewritten', () => {
  const code = [
    '```tex',
    '$$a = 1',
    'b = 2$$',
    '```',
    '',
    '    $$indented',
    '    x$$',
    '',
    '`$$inline$$`',
    ''
  ].join('\n')
  assert.equal(normalizeTexBlocks(code), code)
  assert.equal(normalizeTexBlocks('~~~\n$$a\n~~~\n'), '~~~\n$$a\n~~~\n')
})

test('a $$ inside a code fence cannot close a math block', () => {
  const input = '$$\na = 1\n```\n$$\n```\nb\n'
  assert.equal(normalizeTexBlocks(input), input, 'still unclosed, so left untouched')
})

test('an unclosed block is left exactly as authored', () => {
  assert.equal(normalizeTexBlocks('$$a = 1\nb = 2\n'), '$$a = 1\nb = 2\n')
  assert.equal(normalizeTexBlocks('$$\nprose after\n'), '$$\nprose after\n')
})

test('non-strings and dollar-free sources pass through unchanged', () => {
  assert.equal(normalizeTexBlocks(undefined), undefined)
  assert.equal(normalizeTexBlocks(null), null)
  assert.equal(normalizeTexBlocks('plain text'), 'plain text')
})

test('CRLF sources keep their line endings', () => {
  const crlf = '$$a = 1\r\nb = 2$$\r\n\r\nprose\r\n'
  assert.equal(normalizeTexBlocks(crlf), '$$\r\na = 1\r\nb = 2\r\n$$\r\n\r\nprose\r\n')
})

test('indentation and trailing prose survive a rewrite', () => {
  assert.equal(normalizeTexBlocks('  $$a = 1\n  b = 2$$  tail\n'), '  $$\na = 1\n  b = 2\n  $$\n  tail\n')
})
