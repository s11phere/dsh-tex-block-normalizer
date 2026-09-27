# 实现原理

本插件不修改上游任何文件，也不重建前端 bundle。它利用 DSH Web 客户端已有的模块机制做了一次**外科手术式的运行时补丁**。

## 1. 为什么需要宿主半体

DSH 的浏览器 bundle 是由宿主侧扫描出来的：`dsh-client-modules` 的 Node 半部遍历宿主 Loader 的 entry，找出声明了 `dsh.client` 且 `platform: "web"` 的包，再把它的 `exports["./client"]` 排进浏览器启动图。

所以一个包**必须先作为 profile 的 cordis 插件被加载**，它的客户端代码才会出现在页面里。这就是 `lib/host.js` 存在的原因——它是空实现：

```js
export const name = 'dsh-tex-block-normalizer';
export const inject = [];
export function apply() {}
```

`cordis.patch.yml` 的 `insert:` 行负责把它加进 profile 的 bundle 列表。浏览器半部则由 `package.json` 的 `dsh.client` + `exports["./client"]` 自动发现。

## 2. 为什么插件能碰到渲染器

Web shell 里有一张写死的**静态 seed 模块表**（platform seeds），其中包含：

```js
"@deepseek-ai/dsh-client-ui-primitives"
```

加载器的 `require` 第一步就是查这张表：`if (seed.has(spec)) return seed.get(spec)`。而聊天包自己也是

```js
require("@deepseek-ai/dsh-client-ui-primitives")
```

因此插件 `require` 同一个 specifier 时，拿到的是**同一个模块实例**——也就是同一个 `MarkdownText` 对象。这正是本插件唯一的注入点。

## 3. 补丁本身

`MarkdownText` 是 `React.memo(fn)`。memo 返回的对象把内层渲染函数挂在 `.type` 上，且该对象未被冻结；React 在每次渲染时读取它，所以**即使元素是在打补丁之前创建的也照样生效**。于是：

```js
const inner = MarkdownText.type;
MarkdownText.type = function MarkdownTextWithNormalizedTexBlocks(props) {
  if (props === null || typeof props !== 'object' || typeof props.text !== 'string') return inner(props);
  const text = normalizeTexBlocks(props.text);
  return text === props.text ? inner(props) : inner({ ...props, text });
};
```

几个细节：

- **文本没被改写时传回原始 props 对象**，让内层 `useMemo` 的依赖保持不变，不触发多余的重解析。
- 归一化针对的是组件的 `text` prop，因此覆盖**所有** `MarkdownText` 的消费方（助手正文、compaction 摘要、工具输出、文档预览、plan、deliverables…），而不只是聊天正文。
- 归一化发生在**渲染时**，所以对会话里已经记录的历史消息同样生效，且不改动 session 数据。

为什么不在更上层拦？因为解析函数（`parseGfmWithMath` 等）没有对外导出，`text` prop 是唯一能覆盖全部消费方的注入点。

## 4. 生命周期与守卫

- 在插件激活时通过 `ctx.effect(fn, label)` 安装，插件 dispose 时**还原原函数**；
- 用 `Symbol.for('dsh-tex-block-normalizer:original')` 标记已安装，避免 HMR 换代理后重复包装；
- 三类降级（都只写状态、不抛错）：
  - `globalThis.__DSH_TEX_BLOCK_NORMALIZER_DISABLE__ === true` → 不安装；
  - seed 模块取不到 → `reason: 'seed-unavailable'`；
  - `MarkdownText` 形状不符（上游重构）→ `reason: 'markdown-text-shape-unknown'`；
- 状态句柄 `globalThis.__DSH_TEX_BLOCK_NORMALIZER__` 暴露 `{ installed, reason, stats: { calls, rewrites } }`，便于线上确认。

## 5. 流式渲染下的行为

归一化是**整段文本的纯函数**：块尚未闭合时原样返回，闭合后一次性改成围栏形式。消息还在流式输出时，某个块从"未闭合"变成"已闭合"会让已渲染前缀的行结构变化，增量解析器随之重解析受影响的尾部。这里选择了**正确性优先于增量缓存复用**。

## 6. 为什么不用官方插槽

DSH 的客户端插槽有优先级遮蔽机制（同一个 key 用更低 priority 注册即可替换），`conversation.chat.node` 的类型文档也写着"复用 key 即替换该节点渲染器"。但它按**节点种类**分 key，助手正文属于 `assistant-step`——遮蔽它意味着把整个助手视图（思维链、正文、工具调用、操作行）重新实现一遍。对一处定界符修复来说代价失衡，因此改用第 3 节的组件级补丁。

## 7. 已知的非契约依赖

第 3 节依赖 `React.memo` 的 `.type` 是内层函数这一 React 内部细节。它在 React 18/19 上稳定，但不是公开契约；上游一旦改变实现，插件的守卫会把它降级成 no-op，而不是让界面崩溃。
