# 根因：DSH 为什么这样解析 `$$`

这份文档解释被本插件绕过的上游行为。结论先行：**这不是 KaTeX 的问题，也不是 LaTeX 写法的问题**，而是 DSH 的 Markdown→TeX 取串环节只实现了两种 `$$` 形状，而模型最常用的第三种恰好同时命中"静默丢内容"和"吞掉整篇文档"两条失败路径。

分析对象：`@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.1`（Web 前端的 Markdown 渲染器）。

## 1. DSH 的渲染链路

`MarkdownText` 使用直接 mdast 管线，有两套语法：

| 语法 | 使用时机 | 扩展 |
|---|---|---|
| `parseGfm()` | 流式渲染中 | `gfm()` + 自定义 `cjkFriendlyStrong()`，**不含数学** |
| `parseGfmWithMath()` | 消息定稿后 | 上面这些 + 自定义 `mathCompatibility()` + `math()`（micromark-extension-math） |

流式阶段故意不带数学扩展：未闭合的 TeX 因此只会以字面文本出现，不会中途闪出 KaTeX 报错。定稿后才切到带数学的语法——所以问题总是在**消息结束之后**突然出现。

`parseGfmWithMath()` 的扩展顺序是 `[gfm(), cjkFriendlyStrong(), mathCompatibility(), math()]`。同一字符的流构造按注册顺序尝试，因此 `$` 上先试自定义的 `sameLineDollarMathFlow`，失败后才轮到 `math()` 的 `mathFlow`。

## 2. 它只认两种形状

**形状 1：围栏**（来自 `micromark-extension-math@3.1.0` 的 `mathFlow`）

```markdown
$$
公式
$$
```

约束严格照搬围栏代码块：

- 开栏行是 `$$`，其后到行尾的内容被当作 **info 字符串**（`mathFlowFenceMeta`），**不进入公式**；
- 闭栏必须是**行首**（最多 4 空格缩进）的 `$$`，且其后**只能有空白到行尾**。

**形状 2：单行**（来自 DSH 自带的 `mathCompatibility()`）

```markdown
$$ 公式 $$
```

实现是 `sameLineDollarMathFlow = createMathFlow($, $, $, false)`，最后那个 `false` 即 `multiline`。它的 `content()` 一旦遇到换行就返回 `nok`——所以它**只负责同一行内闭合**的写法，遇到跨行就整体放弃。

## 3. 第三種写法发生了什么

模型常写的 Pandoc 风格：

```markdown
$$\frac{\partial}{\partial y} = 1
\quad\Longrightarrow\quad
x = y$$
```

逐步展开：

1. 行首 `$$` → 先试 `sameLineDollarMathFlow`：消费 `$$` 与行内内容，遇到换行时因 `multiline === false` 返回 **`nok`**，构造整体回滚。
2. 回落到 `math()` 的 `mathFlow`：它接受开栏行 `$$` 之后的内容，但**归类为 `mathFlowFenceMeta`**——也就是公式第一行被丢弃。
3. 该围栏随后要在文件里找一个"行首 + 仅空白到行尾"的 `$$` 才闭合。原文里后续的 `$$` 全都跟着内容（`$$\bm{dz}^{(i)} = ...`），闭栏校验失败，于是**围栏一直延伸到文件末尾**。
4. 这一个 math 节点的 `value` 就是"公式第二行 + 之后所有正文、表格、标题、其它公式"。KaTeX 在第一个裸 `$` 处报错：

   ```
   ParseError: KaTeX parse error: Can't use function '$' in math mode at position N
   ```

5. 渲染器的三段式错误链先以 `throwOnError: true` 抛出，再以 `{ strict: 'ignore', throwOnError: false }` 重试，得到 KaTeX 自己的红色错误 span：`title` 是该 ParseError，**文本子节点是整段被吞掉的原文**。这就是界面上"从公式第二行到消息结尾全是红色纯文本"的来源。

注意渲染器只取 `node.value`，**完全忽略 `node.meta`**——所以第 2 步丢掉的公式首行是无声无息的。

## 4. 五种写法的实际结果

| 写法 | 结果 |
|---|---|
| `$$` 独占一行 … `$$` 独占一行 | ✅ 正常 |
| 整条公式一行 `$$ … $$` | ✅ 正常（形状 2） |
| `$$内容` 开头、`$$` 独占一行收尾 | ⚠️ 正常渲染，但**首行被当 meta 静默丢弃** |
| `$$` 独占一行、`内容$$` 收尾 | ❌ 闭栏永不到来，**吞掉文档剩余部分** |
| `$$内容` 开头、`内容$$` 收尾 | ❌ 丢首行 + 吞文档（最常见的模型写法） |

第 3 行是一个独立的、更隐蔽的坑：文档看起来"渲染成功了"，但公式内容少了一行。

## 5. 为什么 VS Code 正常

VS Code 内置 Markdown 数学走的是 markdown-it 系插件（`@vscode/markdown-it-katex`），规则是 Pandoc 式的：

- 开栏 `$$` 行剩余内容**并入公式**，而不是当 info 字符串丢弃；
- 收尾 `$$` 允许出现在**任意位置**（行尾即可），不要求独占一行。

于是同一段文本在那边被合成**一个**公式，自然正常。差异不在 KaTeX，而在"哪里算开栏、哪里算闭栏"。任何按 Pandoc/KaTeX 习惯输出公式的模型，都可能踩到 DSH 这条边界。

## 6. 复现与验证

仓库里两样东西可以做端到端验证：

```bash
npm install
node scripts/audit-markdown.mjs fixtures/pandoc-style-message.md
```

输出形如（真实会话里的 75 行消息也得到同样结论）：

```
BEFORE: 1 display formula(s), 1 KaTeX failure(s)
   lines  13..32  ERROR \quad\Longrightarrow\quad\n\bm{dy}...
AFTER : 3 display formula(s), 0 KaTeX failure(s)
=> the plugin repairs this file
```

`test/dsh-grammar.test.mjs` 把同样的对照固化成断言：`fixtures/dsh-extensions.snippet.js` 是从 DSH 逐字提取的自定义语法扩展，因此验收测试用的就是 GUI 的语法本体。

## 7. 顺带排除的几个嫌疑

`\bm`（KaTeX 0.16.47 原生支持）、`\text{中文}`、`\Bigl`、`\underbrace`、`\top`、行内 `$...$`——单独渲染全部正常；失败行的 TeX 单独作为公式也完全合法。问题只出在**取串**这一步。
