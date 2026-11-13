# 开发与维护

## 目录结构

| 路径 | 说明 |
|---|---|
| `lib/normalize.js` | 归一化器，**唯一事实来源**：纯函数、零依赖 |
| `lib/client.js` | 浏览器半部，**生成产物**（勿手改） |
| `lib/host.js` | 宿主半部，空实现；作用见 [how-it-works.md](how-it-works.md#1-为什么需要宿主半体) |
| `scripts/build-client.mjs` | 由 `lib/normalize.js` 生成 `lib/client.js` |
| `scripts/dsh-grammar.mjs` | 用 DSH 的真实语法解析 + KaTeX 排版（测试与审计共用） |
| `scripts/audit-markdown.mjs` | 命令行审计任意 Markdown |
| `fixtures/` | 测试夹具：DSH 语法扩展副本 + 复现用的消息样例 |
| `test/` | 21 项测试 |

## 为什么 client.js 是生成产物

浏览器半部被模块系统**原样作为 classic script 提供**，求值时只能 `require` 平台 seed 模块，**不能 `import` 兄弟文件**。所以归一化器必须内联进 `lib/client.js`。为了不出现两份实现：

```bash
npm run build          # 重新生成 lib/client.js
node scripts/build-client.mjs --check   # 产物是否过期（测试里也会跑）
```

生成脚本里有一处必须保持的写法：

```js
// 用函数式替换：字符串替换会把内嵌源码里的 `$$` 当成转义 `$`
const generated = template.replace('__NORMALIZER__', () => embedded);
```

这是开发时真实踩过的坑——`String.prototype.replace` 的字符串替换中 `$$` 表示一个字面 `$`，会把内联进去的 `$$` 字面量悄悄吃掉。`test/client.test.mjs` 里有一条断言专门守着这个（检查产物仍含 `$$` 字面量与 `\$\$` 正则）。

## 测试

```bash
npm install   # devDependencies：micromark 系 parser + katex，仅测试需要
npm test
```

| 文件 | 覆盖 |
|---|---|
| `test/normalize.test.mjs` | 五种定界符写法、幂等、内容保全、代码块/缩进代码/行内代码不动、未闭合不改、CRLF、缩进与尾随文本 |
| `test/client.test.mjs` | 模拟 `window.__ModuleLoader__.load` 求值真实产物：只 `require` seed、打补丁行为、props 复用、不重复包装、dispose 还原、三种降级、禁用开关、产物自包含、产物与源码同步 |
| `test/dsh-grammar.test.mjs` | 验收：原始夹具必须复现失败（1 个吞掉全文的 math 节点 + KaTeX 报错），归一化后必须 3 个公式节点、0 报错、内容不泄漏 |

`test/client.test.mjs` 不依赖浏览器：它给 `globalThis.window.__ModuleLoader__` 装一个收集器，`import()` 真实产物，再用假 `require` 调 factory。缺 devDependencies 时语法验收测试自动 skip。

## 夹具出处

- `fixtures/dsh-extensions.snippet.js` —— 从 `@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.1` 的 `lib/index.js` **逐字提取**的自定义扩展（`cjkFriendlyStrong()`、`mathCompatibility()`），文件头注明来源与许可（DeepSeek Harness，MIT）。有了它，验收测试不需要安装 DSH。
- `fixtures/pandoc-style-message.md` —— 复现用的示例消息：两个"开栏贴内容、收尾贴内容"的块 + 一个单行块，中间夹标题、表格、行内公式。原始必须失败、归一化后必须全绿。

## 审计任意文档

```bash
node scripts/audit-markdown.mjs <file.md> [...]
```

打印每个文件的公式节点数、每个节点的行范围与 KaTeX 判定，并给出归一化前后对照：

```
BEFORE: 2 display formula(s), 1 KaTeX failure(s)
   lines  19..75  ERROR \quad\Longrightarrow\quad\n\bm{dy}^{(i)} = ...
AFTER : 5 display formula(s), 0 KaTeX failure(s)
=> the plugin repairs this file
```

最后一行会区分三种情况：`the plugin repairs this file` / `already clean` / `normalization is a no-op; this failure is not the Pandoc-style $$ bug`——用于判断某个 KaTeX 报错是否属于本插件负责的范围。

## 验证与临时关闭

- 刷新后控制台出现一次 `[dsh-tex-block-normalizer] active: Pandoc-style $$ blocks are normalized before Markdown parsing`。
- devtools 里查看 `__DSH_TEX_BLOCK_NORMALIZER__` → `{ installed: true, reason: 'installed', stats: { calls, rewrites } }`；`rewrites` 增长表示确实改写过。
- 打开此前报错的历史消息：红色纯文本消失、公式正常排版，即生效。
- 临时关闭：页面加载前设 `globalThis.__DSH_TEX_BLOCK_NORMALIZER_DISABLE__ = true`。

## 发版

1. 改 `lib/normalize.js`（必要时改 `lib/client.js` 模板）→ `npm run build` → `npm test`；
2. 更新 `package.json` 的 `version` 与 `CHANGELOG`（如有）；
3. 安装方（本地目录依赖）重新 `dsh plugin --profile web add <本包目录>` 或直接重启 dsh web，浏览器侧受模块系统的 `rev` 机制驱动刷新。

插件目前是**本地/私有包**（`package.json` 中 `private: true`），未发布到 npm。
