# dsh-tex-block-normalizer

DSH Web 客户端插件：修好 **Pandoc 风格 `$$` 公式块**在 DSH 里被误解析的问题——公式首行被静默丢弃、正文/表格/后续公式被吞进一个 KaTeX 报错节点，整段变成红色纯文本。

> English: a DSH web-client plugin that normalizes Pandoc-style `$$` display-math blocks before Markdown parsing, so messages other renderers show correctly no longer turn into a red KaTeX parse error in the DSH GUI.

## 症状

模型常这样写行间公式（开栏 `$$` 与内容同行、正文跨行、收尾 `$$` 贴在最后一个内容行末）：

```markdown
$$\frac{\partial}{\partial y} = 1
\quad\Longrightarrow\quad
x = y$$
```

在 DSH 里它会：首行被当成 info 字符串**静默丢弃**；`$$` 块永不闭合，**从第二行到消息结尾全部被吞**；KaTeX 拿到这一大段非 TeX 文本后报 `ParseError: ... Can't use function '$' in math mode ...`，于是整段显示为红色纯文本（悬停可见该报错）。同一个文件在 VS Code 的 Markdown 预览里是正常的。

## DSH 接受的形状

| 写法 | DSH 0.1.7-rc.1 |
|---|---|
| `$$` 独占一行 … `$$` 独占一行 | ✅ 正确 |
| 整条公式一行 `$$ … $$` | ✅ 正确 |
| `$$内容` 开头、`$$` 独占一行收尾 | ⚠️ 首行被静默丢弃 |
| `$$` 独占一行、`内容$$` 收尾 | ❌ 吞掉文档剩余部分 |
| `$$内容` 开头、`内容$$` 收尾 | ❌ 丢首行 + 吞文档 |

插件把后三种统一搬成第一种：**只移动 `$$` 的换行位置，块内内容一字不改**。对会话里已经记录的历史消息同样生效（归一化发生在渲染时，不修改 session 数据）。

## 安装

```bash
dsh plugin --profile web add <本包目录>
```

然后重启 dsh web 并刷新页面。

## 验证

- 刷新后控制台出现一次 `[dsh-tex-block-normalizer] active: Pandoc-style $$ blocks are normalized before Markdown parsing`。
- devtools 里查看 `__DSH_TEX_BLOCK_NORMALIZER__` → `{ installed: true, reason: 'installed', stats: { calls, rewrites } }`；`rewrites` 增长即表示确实改写过度。
- 打开此前报错的历史消息，红色纯文本消失、公式正常排版。
- 临时关闭：页面加载前设 `globalThis.__DSH_TEX_BLOCK_NORMALIZER_DISABLE__ = true`。
- 命令行审计任意 Markdown（用 DSH 的真实语法 + KaTeX 做归一化前后对照）：

  ```bash
  node scripts/audit-markdown.mjs <file.md>
  ```

## 开发

```bash
npm install     # 仅测试用的 parser / katex devDependencies
npm test        # 21 项：归一化用例 + 打包产物 + DSH 语法验收
npm run build   # 改过 lib/normalize.js 后重新生成 lib/client.js
```

## 限制

- 块引用 / 列表项里的 `$$`（`> $$a`、`- $$a`）不处理。
- 完全没有收尾 `$$` 的块保持原样，因此仍会吞到文件尾。
- 依赖 `React.memo` 的 `.type` 是内层渲染函数这一 React 内部细节；取不到时插件安静地变成 no-op，不会报错影响界面。

完整说明见 [docs/limitations.md](docs/limitations.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/root-cause.md](docs/root-cause.md) | 为什么 DSH 会这样解析：语法模型、上游实现位置、复现证据、与 VS Code 的差异 |
| [docs/how-it-works.md](docs/how-it-works.md) | 插件如何在不改动上游的前提下生效：seed 模块共享、`MarkdownText` 包装、生命周期与守卫 |
| [docs/development.md](docs/development.md) | 构建产物与单一事实来源、测试策略、夹具出处、审计工具 |
| [docs/limitations.md](docs/limitations.md) | 边界条件与背后的设计取舍 |

## License

MIT
