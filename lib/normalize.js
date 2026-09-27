/**
 * Rewrite Pandoc-style display-math blocks into the fenced shape DSH's Markdown
 * grammar actually accepts.
 *
 * DSH (`@deepseek-ai/dsh-client-ui-primitives` 0.1.7-rc.1) recognises exactly
 * two `$$` shapes:
 *
 *   1. `$$` alone on its line ... `$$` alone on its line
 *      — micromark-extension-math's `mathFlow` fence.
 *   2. `$$ ... $$` wholly contained in one line
 *      — the package's own `sameLineDollarMathFlow` compatibility construct.
 *
 * Every other layout is mishandled, and one of them is catastrophic:
 *
 *   - Opening `$$` shares its line with content, the closing `$$` sits at the
 *     end of the last content line (the shape most models emit): the first line
 *     is consumed as `mathFlowFenceMeta` and silently dropped, the block never
 *     closes, and the rest of the document is swallowed into a single math node
 *     whose KaTeX parse error paints everything after it red.
 *   - Opening `$$` alone on its line, closing `$$` attached to content: the
 *     block never closes and swallows the document.
 *   - Opening `$$` attached, closing `$$` alone: renders, but the first line is
 *     silently dropped as meta.
 *
 * This function maps all three onto shape 1 by moving the delimiters onto their
 * own lines. Nothing inside a block is reordered, retyped, or dropped: the only
 * difference between input and output is where the `$$` line breaks fall.
 *
 * Deliberately conservative:
 *   - Fenced code (``` / ~~~), indented code (4 spaces or a tab), and lines that
 *     do not start with `$$` are never touched, so inline code keeps its money.
 *   - A `$$` later on the opening line is left alone (already shape 2, or a
 *     degenerate form DSH renders as literal text with no damage).
 *   - A block with no closing `$$` anywhere is left exactly as authored.
 */

/** An opening fence that can start a code block: up to three spaces, then ``` or ~~~. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** An indented code block: four spaces or a tab. */
const INDENT_CODE = /^(?: {4,}|\t)/
/** A display-math opener: up to three leading spaces, `$$`, then the rest of the line. */
const OPEN = /^( {0,3})\$\$(.*)$/

/**
 * Move display-math delimiters onto their own lines.
 * @param src - Markdown source. Non-strings and sources without `$$` pass through.
 * @returns The same document with Pandoc-style `$$` blocks converted to fences.
 */
export function normalizeTexBlocks(src) {
  if (typeof src !== 'string' || !src.includes('$$')) return src
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const lines = src.split(/\r\n|\n/)
  const out = []
  let fence = null // the still-open code fence marker, e.g. "```"
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const codeFence = FENCE.exec(line)
    if (fence !== null) {
      out.push(line)
      i += 1
      if (codeFence !== null && codeFence[1][0] === fence[0] && codeFence[1].length >= fence.length) fence = null
      continue
    }
    if (codeFence !== null) {
      fence = codeFence[1]
      out.push(line)
      i += 1
      continue
    }
    if (INDENT_CODE.test(line)) {
      out.push(line)
      i += 1
      continue
    }
    const opener = OPEN.exec(line)
    if (opener === null) {
      out.push(line)
      i += 1
      continue
    }
    const indent = opener[1]
    const remainder = opener[2]
    if (remainder.includes('$$')) {
      // Shape 2, or a malformed single-line form that DSH degrades to literal
      // text without damaging the rest of the document. Leave both alone.
      out.push(line)
      i += 1
      continue
    }
    // Locate the line carrying the closing `$$`, skipping code blocks so a
    // stray `$$` inside a fence cannot terminate the math block.
    let closeLine = -1
    let closeAt = -1
    let innerFence = null
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j]
      const candidateFence = FENCE.exec(candidate)
      if (innerFence !== null) {
        if (candidateFence !== null && candidateFence[1][0] === innerFence[0] && candidateFence[1].length >= innerFence.length) innerFence = null
        continue
      }
      if (candidateFence !== null) {
        innerFence = candidateFence[1]
        continue
      }
      const at = candidate.indexOf('$$')
      if (at !== -1) {
        closeLine = j
        closeAt = at
        break
      }
    }
    if (closeLine === -1) {
      // Unclosed: the author's intent is ambiguous, and inventing a delimiter
      // could merge two intended blocks. Leave it exactly as written.
      out.push(line)
      i += 1
      continue
    }
    const body = []
    if (remainder.trim() !== '') body.push(remainder)
    for (let m = i + 1; m < closeLine; m += 1) body.push(lines[m])
    const closing = lines[closeLine]
    const beforeClose = closing.slice(0, closeAt)
    const afterClose = closing.slice(closeAt + 2)
    if (beforeClose.trim() !== '') body.push(beforeClose)
    while (body.length > 0 && body[0].trim() === '') body.shift()
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
    out.push(`${indent}$$`, ...body, `${indent}$$`)
    if (afterClose.trim() !== '') out.push(indent + afterClose.trimStart())
    i = closeLine + 1
  }
  return out.join(eol)
}
