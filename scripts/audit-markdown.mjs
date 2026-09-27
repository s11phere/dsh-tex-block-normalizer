/**
 * Audit any Markdown file against DSH's real grammar, before and after the
 * plugin's normalization.
 *
 *   node scripts/audit-markdown.mjs <file.md>...
 *
 * Prints, per file: display-math node count, each node's line range, and the
 * KaTeX verdict — so a "red wall of text" in the GUI can be reproduced and
 * confirmed fixed from the command line.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { audit } from './dsh-grammar.mjs'
import { normalizeTexBlocks } from '../lib/normalize.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/audit-markdown.mjs <file.md>...')
  process.exit(2)
}

for (const file of files) {
  const path = resolve(file)
  const source = readFileSync(path, 'utf8')
  const before = audit(source)
  const fixed = normalizeTexBlocks(source)
  const after = audit(fixed)
  console.log(`\n=== ${path} ===`)
  console.log(`lines: ${source.split('\n').length} -> ${fixed.split('\n').length} (normalizer only moves $$ delimiters)`)
  for (const [label, result] of [
    ['BEFORE', before],
    ['AFTER ', after]
  ]) {
    console.log(`${label}: ${result.nodes.length} display formula(s), ${result.failures} KaTeX failure(s)`)
    for (const {
      node: {
        value,
        position: { start, end }
      },
      verdict
    } of result.nodes) {
      const oneLine = value.replace(/\n/g, '\\n')
      console.log(`   lines ${String(start.line).padStart(3)}..${String(end.line).padEnd(3)} ${verdict === 'OK' ? 'OK   ' : 'ERROR'} ${oneLine.length > 72 ? oneLine.slice(0, 72) + '…' : oneLine}`)
    }
  }
  if (before.failures > 0 && after.failures === 0) console.log('=> the plugin repairs this file')
  else if (before.failures === 0) console.log('=> already clean')
  else if (source === fixed) console.log('=> normalization is a no-op; this failure is not the Pandoc-style $$ bug')
  else console.log('=> still failing after normalization — inspect manually')
}
