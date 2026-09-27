/**
 * Generate lib/client.js from lib/normalize.js.
 *
 * The browser half must be one self-contained classic script: it is served
 * verbatim as `plugins/<pkg>/client.js`, evaluated in the page, and may only
 * `require` platform seed modules at materialization time. It therefore cannot
 * import a sibling file, so the normalizer is embedded here.
 *
 * Usage:
 *   node scripts/build-client.mjs           # write lib/client.js
 *   node scripts/build-client.mjs --check   # exit 1 when the artifact is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const normalizeUrl = new URL('lib/normalize.js', root)
const targetUrl = new URL('lib/client.js', root)

const source = readFileSync(normalizeUrl, 'utf8')
if (/^\s*import\s/m.test(source)) throw new Error('lib/normalize.js must stay dependency-free: it is embedded into the client bundle')

const embedded = source
  .replace(/^export function normalizeTexBlocks/m, 'function normalizeTexBlocks')
  .trimEnd()

const template = `/**
 * dsh-tex-block-normalizer — browser half.
 *
 * GENERATED FILE: run \`npm run build\` after editing lib/normalize.js.
 *
 * DSH's \`MarkdownText\` is a \`React.memo\` component re-exported through the web
 * shell's static module table, so every client bundle that requires
 * "@deepseek-ai/dsh-client-ui-primitives" receives the same instance. Wrapping
 * that memo's inner function normalizes message source text before the parser
 * sees it, which repairs Pandoc-style \`$$\` blocks for every consumer of
 * MarkdownText — including messages already recorded in a session.
 *
 * Verified against @deepseek-ai/dsh-client-ui-primitives 0.1.7-rc.1: seed table
 * entry + MarkdownText = memo(fn) at lib/index.js. Both are guarded below, so a
 * future refactor turns this plugin into a no-op instead of a crash.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tex-block-normalizer',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    /** Set \`globalThis.__DSH_TEX_BLOCK_NORMALIZER_DISABLE__ = true\` to skip installing. */
    const DISABLE_FLAG = '__DSH_TEX_BLOCK_NORMALIZER_DISABLE__';
    /** Diagnostics handle for devtools: \`__DSH_TEX_BLOCK_NORMALIZER__\`. */
    const STATUS_GLOBAL = '__DSH_TEX_BLOCK_NORMALIZER__';
    /** The shared component seat (web shell static module table). */
    const SEED = '@deepseek-ai/dsh-client-ui-primitives';
    /** Holds the unpatched inner function, so install stays idempotent. */
    const ORIGINAL = Symbol.for('dsh-tex-block-normalizer:original');
    const DIAG = false;

    //#region embedded from lib/normalize.js
__NORMALIZER__
    //#endregion

    function report(status) {
      try {
        globalThis[STATUS_GLOBAL] = status;
      } catch {
        /* a frozen global object must not break rendering */
      }
      return status;
    }

    function isRenderable(component) {
      return component !== null && typeof component === 'object' && typeof component.type === 'function';
    }

    /**
     * Wrap MarkdownText's inner function with the normalizer.
     * @returns An undo handle, or null when there is nothing to do.
     */
    function install() {
      if (globalThis[DISABLE_FLAG] === true) {
        report({ installed: false, reason: 'disabled' });
        return null;
      }
      let primitives;
      try {
        primitives = require(SEED);
      } catch (error) {
        report({ installed: false, reason: 'seed-unavailable', error: String(error) });
        return null;
      }
      const component = primitives === null || primitives === undefined ? undefined : primitives.MarkdownText;
      if (!isRenderable(component)) {
        report({ installed: false, reason: 'markdown-text-shape-unknown' });
        return null;
      }
      const existing = component[ORIGINAL];
      if (existing !== undefined) {
        report({ installed: true, reason: 'already-installed', stats: existing.stats });
        return null;
      }
      const inner = component.type;
      const stats = { calls: 0, rewrites: 0 };
      component[ORIGINAL] = { inner, stats };
      component.type = function MarkdownTextWithNormalizedTexBlocks(props) {
        if (props === null || typeof props !== 'object' || typeof props.text !== 'string') return inner(props);
        stats.calls += 1;
        const text = normalizeTexBlocks(props.text);
        if (text === props.text) return inner(props);
        stats.rewrites += 1;
        if (DIAG) console.info('[dsh-tex-block-normalizer] normalized a Pandoc-style $$ block');
        return inner({ ...props, text });
      };
      report({ installed: true, reason: 'installed', stats });
      console.info('[dsh-tex-block-normalizer] active: Pandoc-style $$ blocks are normalized before Markdown parsing');
      return { component, stats };
    }

    /**
     * Restore the original inner function.
     * @param handle - The handle install() returned, if any.
     */
    function uninstall(handle) {
      if (handle === null || handle === undefined) return;
      const record = handle.component[ORIGINAL];
      if (record === undefined || record.stats !== handle.stats) return;
      handle.component.type = record.inner;
      delete handle.component[ORIGINAL];
      report({ installed: false, reason: 'disposed', stats: handle.stats });
    }

    /** This plugin needs no Cordis services; the patch rides a static module seat. */
    const inject = [];

    function apply(ctx) {
      ctx.effect(() => {
        const handle = install();
        return () => {
          uninstall(handle);
        };
      }, 'dsh-tex-block-normalizer: markdown text patch');
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.normalizeTexBlocks = normalizeTexBlocks;

    return module.exports;
  },
});
`

// NOTE: a *function* replacement — a string replacement would treat the `$$`
// sequences inside the embedded source as an escaped `$` and silently corrupt it.
const generated = template.replace('__NORMALIZER__', () => embedded)
const check = process.argv.includes('--check')
const current = (() => {
  try {
    return readFileSync(targetUrl, 'utf8')
  } catch {
    return undefined
  }
})()

if (check) {
  if (current !== generated) {
    console.error('lib/client.js is stale — run: node scripts/build-client.mjs')
    process.exit(1)
  }
  console.log('lib/client.js is up to date')
} else {
  writeFileSync(targetUrl, generated)
  console.log(`wrote ${fileURLToPath(targetUrl)} (${generated.length} bytes)`)
}
