/**
 * host.js — dsh-tex-block-normalizer 宿主侧插件。
 *
 * 这个插件**没有宿主侧行为**：修复完全发生在浏览器半部（`lib/client.js`）。
 * 宿主半体存在的唯一原因是机制要求 —— `dsh-client-modules` 的
 * `ClientModuleRegistry` 是**扫描宿主 Loader 的 entry** 来发现 `dsh.client`
 * 声明的，一个包必须先作为 profile 的 cordis 插件被加载，它的
 * `exports["./client"]` 才会进入浏览器启动图。
 *
 * 因此这里刻意保持空实现：零依赖、零副作用、零服务注入。
 */

/** 插件 id，必须与 cordis.patch.yml 的 insert id 一致。 */
export const name = 'dsh-tex-block-normalizer';

/** 不需要任何宿主服务。 */
export const inject = [];

/**
 * 不做任何事：浏览器半部在客户端容器激活时自行安装补丁。
 */
export function apply() {}
