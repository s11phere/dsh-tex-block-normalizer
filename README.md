# dsh-tex-block-normalizer

DSH Web 客户端插件：修好 **Pandoc 风格的 `$$` 公式块**在 DSH 里被误解析的问题——公式首行被静默丢弃，正文、表格或后续公式被吞进一个 KaTeX 报错节点。插件只移动 `$$` 的换行位置，块内内容一字不改。

## 安装

```bash
dsh plugin --profile web add github:TianzeLuo/dsh-tex-block-normalizer
```

1. 重启 `dsh web`
2. 刷新页面

开发调试时可改装本地目录：`dsh plugin --profile web add /path/to/dsh-tex-block-normalizer`。

装不上或装完没反应，看 [已知限制](docs/limitations.md)。

## 兼容性

| 项 | 值 |
| --- | --- |
| DSH | `>=0.2.2-rc.3`（只写下界） |
| 验证于 | 0.2.2-rc.3（2026-11-13，21 项离线测试通过） |
| Node | `>=22.5` |
| 平台 | WSL2 / Linux 已验证；Windows 未在当前版本复测 |

## 能做什么

- **修好被吞掉的公式块**：把「开栏贴内容、收尾贴内容」这类 Pandoc 写法搬成 DSH 认识的形状。
- **保留块内内容**：只调整 `$$` 的换行位置，公式、正文与表格不改写。
- **历史消息同样生效**：归一化发生在渲染时，不修改已保存的会话数据。
- **宿主变化时安静降级**：取不到需要的宿主内部形状时变成 no-op，不影响页面渲染。

## 用法

| 触发方式 | 位置 | 行为 |
| --- | --- | --- |
| 打开消息 | 已安装插件的会话 | 渲染前归一化消息里的 `$$` 块，红色 KaTeX 报错消失、公式正常排版 |
| 验证历史消息 | 之前报错的会话 | 历史消息也在渲染时修复，不需要重发 |

关掉插件后：渲染回到 DSH 原生行为，Pandoc 风格的 `$$` 块会再次出现首行丢失或被吞的问题。

修复范围、失败模式与控制台状态见 [实现说明](docs/how-it-works.md) 与 [已知限制](docs/limitations.md)。

## 已知限制

- 块引用 / 列表项里的 `$$`（`> $$`、`- $$`）不处理。
- 完全没有收尾 `$$` 的块保持原样，因此仍可能吞到文件尾。
- 只修定界符取串这一类失败；真正的 TeX 语法错误仍会照常由 KaTeX 报错。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/development.md](docs/development.md) | 目录结构、构建、测试与验证方式 |
| [docs/limitations.md](docs/limitations.md) | 边界条件与设计取舍 |
| [docs/how-it-works.md](docs/how-it-works.md) | 生效方式、生命周期与守卫 |
| [docs/root-cause.md](docs/root-cause.md) | 为什么 DSH 会这样解析、复现与上游差异 |

## 隐私与数据

- 读取：会话消息的 Markdown 文本与公式块。
- 外发：不发起任何网络请求。
- 存储：不写文件；只在浏览器内改写待渲染文本。
- 关闭后：不再包装渲染组件，页面恢复宿主原生行为。

## 许可证

MIT，见 [LICENSE](LICENSE)。
