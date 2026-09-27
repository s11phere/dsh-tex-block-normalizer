/**
 * Build the exact Markdown grammar the DSH web GUI uses, for auditing any file
 * against it: GFM + DSH's CJK-friendly strong extension + DSH's math
 * compatibility extension + micromark-extension-math, with KaTeX typesetting.
 *
 * The two custom extensions are vendored verbatim in
 * `fixtures/dsh-extensions.snippet.js` (see its provenance header), so this
 * works without an installed DSH. Requires the devDependencies.
 */
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { attention } from 'micromark-core-commonmark'
import { markdownLineEnding, unicodePunctuation } from 'micromark-util-character'
import { classifyCharacter } from 'micromark-util-classify-character'
import { codes, constants, types } from 'micromark-util-symbol'
import { factorySpace } from 'micromark-factory-space'
import katexModule from 'katex'

const katex = typeof katexModule.renderToString === 'function' ? katexModule : katexModule.default
const snippet = readFileSync(new URL('../fixtures/dsh-extensions.snippet.js', import.meta.url), 'utf8')

const { cjkFriendlyStrong, mathCompatibility } = new Function(
  'attention',
  'markdownLineEnding',
  'unicodePunctuation',
  'classifyCharacter',
  'codes',
  'constants',
  'types',
  'factorySpace',
  `${snippet}\nreturn { cjkFriendlyStrong, mathCompatibility };`
)(attention, markdownLineEnding, unicodePunctuation, classifyCharacter, codes, constants, types, factorySpace)

/** This is DSH's `parseGfmWithMath` minus local-image recovery, which does not affect math. */
export function parseGfmWithMath(text) {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
  })
}

/** DSH's streaming arm: the same grammar without the math extensions. */
export function parseGfm(text) {
  return fromMarkdown(text, { extensions: [gfm(), cjkFriendlyStrong()], mdastExtensions: [gfmFromMarkdown()] })
}

/** Every `math` (display) or `inlineMath` node, in document order. */
export function mathNodes(tree, kind) {
  const out = []
  const walk = (node) => {
    if (node.type === 'math' || node.type === 'inlineMath') {
      if (kind === undefined || node.type === kind) out.push(node)
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return out
}

/** Typeset one TeX string exactly as the GUI does; throws on a parse error. */
export function typeset(tex) {
  return katex.renderToString(tex, { displayMode: true, throwOnError: true })
}

/**
 * Parse a document and typeset every display formula.
 * @returns Display-math nodes, each with a `katex` verdict (error message or 'OK').
 */
export function audit(text) {
  const tree = parseGfmWithMath(text)
  const nodes = mathNodes(tree, 'math').map((node) => {
    try {
      typeset(node.value)
      return { node, verdict: 'OK' }
    } catch (error) {
      return { node, verdict: String(error).split('\n')[0] }
    }
  })
  return { tree, nodes, failures: nodes.filter((entry) => entry.verdict !== 'OK').length }
}
