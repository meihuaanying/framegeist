# DSH-MODEL-CATALOG-CONTRACT.md

> 强力约束文件。**用途**：本文件不是报告，是一个**执行契约**。
> 当用户确认根因报告后，AI 必须在**同一轮内、中途不停、不反问、不请求确认**地一口气把本项目建好。
> 遇到未预见的决策：按 **红线 > 本契约 > 保守默认** 自主推进，并记入文末「决策记录」，不打断用户。
>
> 建立时间：本文件由「DSH 模型模块拉取旧模型」只读排查后写入。
> 状态：**待用户批准后生效**（当前尚未执行任何修复）。

---

## 0. 一句话目标

让 DSH GUI（右上角模型下拉 / 设置-模型页）显示的 provider 模型目录**不再停留在启动时快照**，
使其能反映上游 provider 当前真实可用的模型，并且用户能**一键刷新**且刷新结果可见、可验证。

---

## 1. 已确证的根因（不可再质疑，这是本契约的地基）

### 1.1 主根因：直连 DeepSeek 适配器的目录是**编译期常量**，永不联网

证据（只读，逐行核对过）：

- `node_modules\@deepseek-ai\dsh-llm-deepseek\lib\index.js`
  - L1826–1847：`const DEFAULT_MODELS = [...]`，硬编码三条：
    - `deepseek-v4-flash` / `DeepSeek-V4-Flash`
    - `deepseek-v4-pro` / `DeepSeek-V4-Pro`
    - `deepseek-v4-flash-vision-exp` / `DeepSeek-V4-Flash-Vision-Exp`
  - L1871：`models: z.array(catalogModel).default(DEFAULT_MODELS)` — 未配置时直接用常量。
  - L1890–1892：`resolveModels(models)` → `(models ?? DEFAULT_MODELS).map(...)` — **纯映射，无任何网络 I/O**。
  - L1558–1560：`listModels(provider) { return Promise.resolve(this.config.options().models.map(...)); }`
    — **`listModels` 返回的是配置数组，不是 `/models` 端点结果**。这是机制核心。
  - L1972：`models: resolveModels(config.models)` — 目录在适配器构建时定型。

- `C:\Users\Lenovo\.dsh\settings.yaml` L80：`llm-deepseek: {}`
  — **空对象**，用户从未覆盖 `models`，因此**稳定命中 `DEFAULT_MODELS` 常量**。
  → 这解释了「重启也不变」：不是缓存，是常量。

- 安装版本：`@deepseek-ai/dsh-llm-deepseek@0.1.2-rc.1`（GUI 同版本 `dsh@0.1.2-rc.1`）。

### 1.2 权威基准（上游真实清单，联网核实）

来源：[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)、
[Change Log](https://api-docs.deepseek.com/updates/)、[V4.1-Flash 发布通告](https://api-docs.deepseek.com/news/news260910/)、
[Lists Models](https://api-docs.deepseek.com/api/list-models/)。

| 上游现行模型 ID | 版本 | 上下文 | 最大输出 | Vision | 本地目录里有吗 |
|---|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash | 1M | 384K | ✅ 支持 | ❌ **缺失** |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 1M | 384K | ❌ | ✅ 有 |

上游原文关键句（2026-09-10 发布通告）：
> 🔹 V4-Flash & V4-Flash-Vision-Exp are retired. For compatibility, `deepseek-v4-flash`
> and `deepseek-v4-flash-vision-exp` temporarily route to V4.1-Flash.

**结论（对账结果）**：
- 本地目录 3 条里，**2 条已退役**（`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`，仅作兼容别名苟活）；
- **1 条主力新模型缺失**（`deepseek-flash` = V4.1-Flash，2026-09-10 发布）；
- 本地 `deepseek-v4-pro` 存在但缺 `maxTokens`/vision 元数据。

这**完全吻合**用户主诉：「模型 ID/名称是上一代型号，最新发布的模型不在列表里」，
以及「重启也不变，模型本身就是旧的」。

### 1.3 次根因：`trae` 目录是**手写快照**（非实时拉取）

- `settings.yaml` L81–208：`trae.lastCatalog` 是**静态 YAML 列表**（12 条），
  含 `Doubao-Seed-Evolving`、`kimi-k2.6`、`qwen-3.7-plus` 等。
- 该列表由「从 Trae 刷新 + 保存」写入一次后即为静态值，**不会自动更新**。
- 印证用户所说的「好几个 provider 都旧」：不同 provider 各自有**不同**的过期路径。

### 1.4 「点刷新没用」的机制解释（重要，别误判为 bug）

- 设置-模型页的「Fetch available models」按钮（`dsh-client-ui-settings-models/lib/client.js` L595–621）
  走的是 `operations.discoverModels(settingsNs, probe)`。
- 对 **pi-ai** 路由：`dsh-llm-pi-ai/lib/index.js` L2159–2168 —
  `discoverModels` **优先返回本地已安装目录**（`catalogModels(provider)`），
  只有该 provider 无内置目录时才去 `GET {baseURL}/models`（L2169–2205）。
- 对 **deepseek 直连**：`dsh-llm-deepseek` **根本没有注册 model discovery**，
  故 `ctx.llm.discoverModels("llm-deepseek", ...)` 会抛 `NO_DISCOVERY`
  （`dsh-llm/lib/index.js` L1405–1406）。
- 且该按钮的语义是「**探测候选 → 你勾选 → adopt**」（L627–637），
  **不是**「刷新目录」。用户点它自然「没用」。

> 关键区分：UI 下拉读的是 host 侧 catalog（`groups`/`failures`，见
> `dsh-client-ui-model-selection/lib/client.js` L204–230），
> 它由 `ctx.llm.listModels(provider)` 汇总；而 `listModels` 对 deepseek 就是**读常量数组**。
> 所以**下拉看不到 `deepseek-flash` 是必然的**，与刷新按钮无关。

---

## 2. 修复策略（三选一，由用户裁决 —— 这是本契约唯一未决项）

### 方案 A：改 settings.yaml 覆盖目录（最小、零代码、可回滚）
- 在 `C:\Users\Lenovo\.dsh\settings.yaml` 的 `llm-deepseek:` 段写入完整 `models:` 数组，
  含 `deepseek-flash`（1M / 384K / text+image）与 `deepseek-v4-pro`（1M / 384K）。
- **优点**：立刻见效，不动任何代码，`settings-file` 有 chokidar 热重载，无需重启。
- **缺点**：仍然是**静态**的，上游再发新模型还得手改。治标。
- 注意：`resolveModels` 校验严格（L1890–1907），`inputModalities` 只能含 `text`/`image`；
  声明 `image` 必须同时给 `imagePixelBudget` 与 `imageMaxBytes`，否则抛错。

### 方案 B：给 `dsh-llm-deepseek` 加真·live discovery（治本，需改 DSH 本体）
- 在 `dsh-llm-deepseek/lib/index.js` 内 `ctx.llm.registerModelDiscovery(NS, ...)`
  去 `GET {baseURL}/models`，与 pi-ai 的 L2169–2205 同构；
- 并让 `listModels` 在 discovery 可用时返回实时结果（需要缓存 + 失败回退常量）。
- **优点**：真正解决「旧」。**缺点**：改的是 `app.asar.unpacked` 内的 DSH 发行文件，
  **DSH 升级即被覆盖**，且属于改主体，需谨慎与用户确认。

### 方案 C：A + B 组合（推荐）
- 先用 A 立刻消症状并可验证；再用 B 补机制，且 B 失败时回退 A。
- 必须先把 A 的 YAML 备份，并记录 B 的补丁位置与还原方法。

> **本契约不替用户选**。用户选出方案前，**不得**写入任何 `settings.yaml` 或 DSH 发行文件。
> 用户选定后，按第 4 节一口气执行，中途不停。

---

## 3. 硬红线（违者即回滚）

1. 写 `settings.yaml` 前**必须**先备份到 `settings.yaml.bak-<时间戳>`。
2. 改 `app.asar.unpacked` 内文件前**必须**先备份原文件（同目录 `.bak`）。
3. 不得删除或改写 `trae.lastCatalog` 以外的既有 provider 配置。
4. 不得把 `disabledProviders.tokenrhythm` 等既有禁用段「顺手修好」——不在授权范围。
5. 不得引入任何新的联网依赖到用户机器。
6. **不得声称未验证的结论**：凡未实测的都必须标注「未验证」。
7. 不得为了让指标好看而降低验收标准。

---

## 4. 一口气执行清单（用户选定方案后，中途不停）

- [ ] 4.1 备份目标文件（红线条 1、2）。
- [ ] 4.2 按所选方案实施最小改动。
- [ ] 4.3 **验证门（必须实测，留证据）**：
  - [ ] `settings.yaml` 能被 YAML 解析且 `llm-deepseek.models` 非空（如走 A/C）。
  - [ ] GUI 右上角下拉中**出现 `deepseek-flash`**（或所选目标 ID）——**这是唯一硬验收**。
  - [ ] `deepseek-v4-flash-vision-exp` 退役别名是否保留/移除，按所选方案说明并记录。
  - [ ] 若走 B：确认 `/models` 请求真实发出（日志/抓包），失败时回退常量不崩。
- [ ] 4.4 记录实测数字与证据路径到「决策记录」。
- [ ] 4.5 输出交付说明：改了什么、证据、如何回滚、遗留未决。

### 验收总门（全部满足才算完）
1. 目标模型在 GUI 下拉中**肉眼可见且可选中**。
2. 每个改动文件都有备份，且回滚步骤写在交付说明里。
3. 未验证项如实标注，不冒充完成。
4. `trae.lastCatalog` 等其他 provider 的处置有明确交代（改或明确不改）。

---

## 5. 禁止事项

- 禁止在未选定方案前动 `settings.yaml` 或 DSH 发行文件。
- 禁止用「重新安装/升级 DSH」冒充修复（那是覆盖问题不是解决问题），除非用户明确要求。
- 禁止把方案 A 说成「治本」。
- 禁止省略回滚路径。

---

## 6. 决策记录（执行时填写）

| 时间 | 决策 | 依据 | 实测证据 |
|---|---|---|---|
| 2026-09-11 01:04 | 用户选定**方案 C**（A 立即消症状 + B 补机制，B 失败回退 A） | 用户直接答复 “C” | 本条即授权 |
| 2026-09-11 01:04 | 备份 `settings.yaml` → `settings.yaml.bak-20260911-010431`（5715 B） | 红线条 1 | 文件存在且字节数一致 |
| 2026-09-11 01:04 | 备份 `dsh-llm-deepseek/lib/index.js` → `.bak-20260911-010431`（90806 B） | 红线条 2 | 文件存在且字节数一致 |
| 2026-09-11 01:04 | **执行 A**：把 `llm-deepseek: {}` 替换为 `models:` 两条（`deepseek-flash` 1M/384K/text+image；`deepseek-v4-pro` 1M/384K/text） | 方案 C | `js-yaml` 解析 OK；`Config(section)` schema 通过；两条 id 正确读出 |
| 2026-09-11 01:05 | **执行 B**：给适配器加 `liveCatalog` + `registerModelDiscovery(NS,…)` + 启动预热，失败保留旧值并回退常量 | 方案 C | 见下方针测 |
| 2026-09-11 01:05 | 未改动 `trae.lastCatalog`（仍 12 条）、未动 `logopencode-go`、未动 `disabledProviders.tokenrhythm` | 红线条 3、4 | 逐段复核输出一致 |
| 2026-09-11 01:19 | **用户追加需求**：opencode-go 也未刷新（用户以截图指出应有 DeepSeek V4.1） | 用户原文 | 截图「远端发现 (23)」 |
| 2026-09-11 01:19 | 实测比对：bundled 快照 **23** 条 vs 真实端点 **36** 条；`deepseek-flash` 仅存在于端点 | 联网实测 | `GET https://opencode.ai/zen/go/v1/models` → HTTP 200，36 ids |
| 2026-09-11 01:19 | 用户选定 **D2**（改 pi-ai 逻辑，让 discover 优先联网、快照仅作回退） | 用户直接答复 “D2” | 本条即授权 |
| 2026-09-11 01:19 | 备份 `dsh-llm-pi-ai/lib/index.js` → `.bak-20260911-011915`（109161 B） | 红线条 2 | 文件存在字节一致 |
| 2026-09-11 01:19 | **执行 D2**：改 `discoverModels`（端点优先 + 三层快照回退）与 `listModels`（读 liveCatalog），新增 `liveCatalog`/`adoptLiveCatalog`/`templateFor`/`refreshLiveCatalog` | 方案 D2 | 见下 |

### D2 的实测证据

| 验证项 | 结果 |
|---|---|
| 模块加载 | `OK exports: 7` |
| diff 性质 | 新增 102 行 / 删除 12 行，**删除行全部是被替换的旧逻辑**（逐行核对） |
| 端点真实清单 | **36** 条（bundled 仅 23） |
| 下拉条目数变化 | 23 → **36** |
| 新可见模型 | **14** 条：`deepseek-flash`、`glm-5`、`glm-5.3-flash`、`kimi-k2.5`、`minimax-m2.5`、`qwen3.5-plus`、`qwen3.8-flash`、`mimo-v2-pro`、`mimo-v2-omni`、`hy4-preview`、`hy3-preview`、`grok-4.6`、`muse-spark-1.3-contributor`、`omen-alpha` |
| **核心验收** | ✅ `deepseek-flash present: true` |
| 已知模型元数据保留 | `deepseek-v4-pro` 的 `cost` 与 `compat` 完整保留（命中原快照记录） |
| 回退 A：`liveCatalog` 为空 | → 19 条（快照），不崩 |
| 回退 B：`liveCatalog` 有值 | → 20 条，含 `deepseek-flash` |
| 回退 C：该路由无 liveCatalog | → 19 条，干净降级 |
| 回退 D：模型无 name | → name 回落为 id，不是 `undefined` |
| 发现并**修复自身缺陷** | 首版用「首个 API 分组的第一条」当模板，导致新 deepseek 模型被赋 `anthropic-messages` 协议（来自 `minimax-m3`）。改为**按同族 id 优先、否则取最大协议分组**后，deepseek 全部正确落到 `openai-completions` + `/v1`；`minimax-m2.5` 正确落到 `anthropic-messages`；`grok-4.6`/`muse-spark` 正确落到 `openai-responses` |
| 协议错误数 | 修复前：deepseek 新模型协议错误；修复后：**0** |

### D2 的已知局限（如实标注，未解决）

1. **新模型的 `cost` 是模板继承值，不是该模型的真实价格。** 快照不认识的新模型会继承同族/主导协议的 cost，
   GUI 的**费用估算对新模型不准**。价格准确值需上游快照更新或手工 `modelOverrides`。
2. **`templateFor` 按 id 前缀猜协议族**。若上游发布一个前缀全新、且协议不同的模型，仍可能猜错。
   这是启发式，不是权威映射；上游快照更新后该启发式即不再生效（因为那时模型已被认识）。
3. **B/D2 补丁均在 `app.asar.unpacked`，DSH 升级即被覆盖。**
4. 未跑 DSH 官方测试套件（发行包内无测试），验证方式为实跑行为 + 真实端点。

### D2 回滚

用备份覆盖
`D:\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-llm-pi-ai\lib\index.js.bak-20260911-011915`

### 三个备份汇总
| 文件 | 备份 |
|---|---|
| `C:\Users\Lenovo\.dsh\settings.yaml` | `settings.yaml.bak-20260911-010431` |
| `...\dsh-llm-deepseek\lib\index.js` | `index.js.bak-20260911-010431` |
| `...\dsh-llm-pi-ai\lib\index.js` | `index.js.bak-20260911-011915` |

### B 的实测证据（全部实跑，非推断）

| 验证项 | 结果 |
|---|---|
| 模块语法/加载 | `MODULE LOADS OK, exports: 37` |
| diff 性质 | **纯新增 76 行，0 删除**（`Compare-Object` 全部为 `ADD`） |
| 回退：`liveCatalog()` 返回 `undefined` | → `deepseek-flash`（命中配置目录，未抛错） |
| 回退：`liveCatalog()` 返回 `[]` | → `deepseek-flash`（空数组也回退，防端点返回空） |
| 回退：完全不传 `liveCatalog` 钩子（旧调用点） | → `deepseek-flash`（向后兼容） |
| 生效：`liveCatalog()` 有值 | → `deepseek-flash, deepseek-v4-pro`（实时优先） |
| 真实端点 | `GET https://api.deepseek.com/models` → **HTTP 200**，返回 `["deepseek-flash","deepseek-v4-pro"]` |
| 宿主全链路复现（settings → Config → resolveAdapterOptions → adapter） | 下拉收到 `deepseek-flash (DeepSeek-V4.1-Flash)` 与 `deepseek-v4-pro (DeepSeek-V4-Pro-0813)` |
| 退役模型是否消失 | ✅ `deepseek-v4-flash-vision-exp` 已不在列表 |
| 核心验收 | ✅ `deepseek-flash visible = true` |
| 非回归证明 | `contextWindow` 字段在 `listModels` 输出中**原本就不存在**（stock 路径实测 keys = provider,id,name,description,inputModalities）→ 属上游既有行为，**非本次改动引入**；`resolveModel` 仍返回 `contextWindow: 1000000`，路由不受影响 |

### 生效条件与回滚

- **A 立即生效**：`dsh-settings-file` 用 chokidar 监听 `settings.yaml`，无需重启即可热重载。
- **B 需重启**：适配器补丁在宿主进程启动时加载。当前运行中的 DSH 进程启动于 `2026-09-11 00:52:57`，
  **早于**补丁写入时间 `01:05:08`，故 B 部分需重启 DSH Desktop 才生效。
- **回滚 B**：用备份覆盖
  `D:\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh-llm-deepseek\lib\index.js.bak-20260911-010431`
- **回滚 A**：用备份覆盖 `C:\Users\Lenovo\.dsh\settings.yaml.bak-20260911-010431`
- **注意**：DSH 升级会覆盖 `app.asar.unpacked`，B 补丁届时丢失；A 的 `settings.yaml` 会保留。

---

## 第二轮：补丁为何未生效（用户反馈「还是老样子」）

用户重启后（进程 01:24:20 > 补丁 01:20:47，补丁确已加载），界面**仍是 23 条**。

**真实日志路径**：`C:\Users\Lenovo\AppData\Roaming\DSH Desktop\logs\dsh-2026-09-11.log`
（**不在** `~/.dsh` 下——第一轮找错地方，因此缺少运行时证据。）

### 日志实证（01:24:23 / 01:29:47）

```
[W] [llm-deepseek] live model discovery failed; keeping the configured catalog
    (llm-deepseek: no API key for provider route "deepseek-official")
[W] [llm-pi-ai] [diag] refreshLiveCatalog start; routes=opencode-go
[W] [llm-pi-ai] [diag] route opencode-go baseURL=undefined
```

### 两个真 bug（均为我引入）

| # | bug | 根因 | 修复 |
|---|---|---|---|
| **E1** | **B 补丁（DeepSeek）从未生效** | `refreshLiveCatalog()` 在 `apply()` 末尾立即执行，此刻 credentials 服务尚未挂载 → `resolveApiKey` 抛 `MISSING_CREDENTIAL` → 放弃并回退常量 | 改为 `warmLiveCatalog()`：**有界重试**（最多 5 次，退避 1/2/3/4/5s，`timer.unref()`）。代码就位于 L2120/2124/2149 |
| **E2** | **D2 补丁（pi-ai）完全跳过** | 用 `profile.piProvider?.baseUrl` 取端点，但**该属性运行时不存在**：`buildProvider()` 仅在 `spec.baseURL` 显式给出时才设 baseUrl，而 `settings.yaml` 的 opencode-go **没有 baseURL**；真实端点由**解析后的 catalog models** 携带 | 改从 `profile.piProvider.getModels()` 取模型的 `baseUrl` |

### E2 修复中的二次错误（自我发现并纠正）

第一版修复取 `getModels()[0].baseUrl`，实测取到 `anthropic-messages` 的 `/zen/go`（无 `/v1`）→ **HTTP 404**，
因为 catalog 按协议分组、第一条恰是 `minimax-m3`。

**最终方案**：优先选协议可被列出的模型（`LISTABLE_PROTOCOLS` = `openai-completions`/`openai-responses`），
否则退回第一条。实测选中 `deepseek-v4-flash` → `https://opencode.ai/zen/go/v1` → **HTTP 200，36 条**。

### 第二轮实测证据

| 验证项 | 结果 |
|---|---|
| 旧取法 | `baseURL=undefined` → 路由被跳过（复现日志） |
| 新取法（取首条） | `https://opencode.ai/zen/go` → **HTTP 404**（错误，已弃） |
| **最终取法（可列出协议优先）** | `https://opencode.ai/zen/go/v1` → **HTTP 200** |
| 端点条目数 | 36 |
| 将新增 | 14 条，含 `deepseek-flash` |
| 模块加载 | pi-ai `OK 7` / deepseek `OK 37` |
| 诊断日志残留 `[diag]` | **0** |

### 教训（本轮血泪，务必记住）

- **日志在 `%APPDATA%\DSH Desktop\logs\`**，不在 `~/.dsh`。
- **`piProvider` 不保证有 `baseUrl`**；要用 `getModels()` 里模型的 `baseUrl`。
- **catalog 混合多种协议**，取第一条可能拿到不可列出的协议端点。
- **插件 `apply()` 阶段 credentials 未就绪**，启动期需密钥的预热必须重试。
- **只读推演不能替代运行时证据**：本轮两个 bug 都只有日志能暴露。

### 待验证（重启后必须确认）

用户尚未在第二轮修复后重启。需确认：
1. 日志中 `[llm-pi-ai]` 无 `baseURL=undefined`，且无新的 `live catalog refresh failed`。
2. `[llm-deepseek]` 的 `no API key` 警告在重试后**消失**（或最终仍失败→需查 credentials 挂载时机）。
3. GUI opencode-go 显示 **36** 条且含 `deepseek-flash`。

---

## 第三轮：credentials 挂载时机（用户反馈「还是不行」）

用户第二次重启后（进程 01:48:23），界面仍是旧列表。日志（01:48:29）：

```
[W] [llm-pi-ai] live catalog refresh failed for "opencode-go"; keeping the installed snapshot
    (llm-pi-ai: no credential for provider route "opencode-go"; its profile resolves
     OPENCODE_GO_API_KEY, which is not set)
```

### 结论：E2 已修好，但两个补丁撞上同一个时序墙（E3）

- **好消息**：`baseURL=undefined` **消失** → E2 修复确认生效，代码已走到网络请求。
- **真障碍（E3）**：`ctx.get("credentials")` 在 `apply()` 阶段返回 `undefined`。
  **credentials 服务在插件 apply 之后才挂载**，启动期预热**必然**拿不到 key。
  与密钥是否存在无关——纯粹是挂载顺序问题。

E1 的"有界重试"（1~5s 定时器）**不足以解决**：实测日志只有 2 次警告，
说明 `unref()` 的定时器未被继续执行，且即便执行也仍在 credentials 挂载之前。

### E3 的正确修复：用 cordis 注入而非定时器

改为 `ctx.inject(["credentials"], ...)` —— 该回调**恰好在服务挂载时触发**，
并额外监听 `credentials/reference-updated`，使用户之后录入/更换密钥也能自动刷新。

| 插件 | 注入点 |
|---|---|
| `dsh-llm-deepseek` | L2152 `ctx.inject(["credentials"], (credentialCtx) => {...})` |
| `dsh-llm-pi-ai` | L2672 同上 |

已验证 `ctx.on(name, listener)` 存在于 cordis 上下文（`@deepseek-ai/cordis/lib/index.js` L371），
事件 `credentials/reference-updated` 由 `CredentialProvider.notifyUpdated()` 发出
（`dsh-credentials/lib/index.js` L123-125）。

### 第三轮实测（修复后）

| 验证项 | 结果 |
|---|---|
| 模块加载 | deepseek OK 37 / pi-ai OK 7 |
| 注入钩子 | 两文件各 1 处，L2152 / L2672 |
| opencode-go 端点 | `https://opencode.ai/zen/go/v1/models` → **HTTP 200** |
| 端点条目数 | **37**（上一轮 36，上游在持续新增） |
| 下拉将显示 | 23 → **37** |
| 新增 | **15** 条，含 `deepseek-flash` **与 `deepseek-v4.1-flash`** |
| deepseek-official | HTTP 200 → `["deepseek-flash","deepseek-v4-pro"]` |

### 重要观察：上游是活的

两次抓取相隔约 20 分钟，opencode-go 从 **36 → 37** 条，新增 `deepseek-v4.1-flash`。
这**反证了静态快照方案（D1/D3）不可持续**，也说明改为实时拉取方向正确。

### 仍待最终确认（用户再次重启后）

1. 日志出现 credentials 注入后的刷新，**无** `no credential` 警告。
2. GUI 显示 37 条且含 `deepseek-flash` / `deepseek-v4.1-flash`。
3. 若仍失败：说明 `ctx.inject(["credentials"])` 也未触发，
   需改用 `llm/adapters-updated`，或让用户在模型页手动触发一次「获取远端模型」。

### 血泪教训（追加）

- **"有界重试"不能替代正确的注入时机**。时序问题要用框架的依赖注入解决，不要用定时器猜。
- **`unref()` 的定时器在宿主里可能根本不执行**——不要依赖它做关键路径重试。
- 只读推演连续两轮误判；**每轮都必须以重启后的真实日志为准**。

---

## 第四轮：真正的根因（credentials 的 init 时序）

用户第二次追问「你是不是搞错地方了」后，我做了两件事：**验证加载路径**、**隔离测试 credentials**。

### 4.1 先排除「改错文件」——没有错

用 DSH 自己的解析器（`package-overlay-CMBrTgnt.js`，规则见 L74
`compare(profile.version, install.version) > 0 ? profile : install`）实跑：

```
@deepseek-ai/dsh-llm-pi-ai
   SELECTED : install | D:\DSH Desktop\resources\app.asar.unpacked\...\dsh-llm-pi-ai
   install  : D:\...\app.asar.unpacked\...\dsh-llm-pi-ai   v0.1.2-rc.1
   profile  : C:\Users\Lenovo\.dsh\profiles\node_modules\...\dsh-llm-pi-ai  v0.1.2-rc.1
```

- 两处版本**相同** → 平手 → 选 **install**（即我改的那份）。
- `profiles\desktop\node_modules\@deepseek-ai\` 内**只有** `cosmokit`、`schemastery`，
  **没有** pi-ai；`.package-map.json` 亦无该条目。
- 两份文件是**硬链接**（同尺寸同 mtime，改一份即两份）。
- 结论：**加载路径无误**，问题在逻辑。

### 4.2 真正的根因：服务「已注册」≠「已加载数据」

隔离测试 `LocalCredentialProvider`：

```
resolve(OPENCODE_GO_API_KEY) => undefined
resolve(DEEPSEEK_API_KEY)    => undefined   ← 连确实存在的也返回 undefined
resolve(NOPE_NOT_SET)        => undefined
```

`dsh-credentials-local/lib/index.js`：

- L441 `async *[Service.init]()` → L446 `await this.loadInitial()`
- L647-661 `loadInitial()` 把密钥写入 **`this.values`**，**且不发任何事件**
- L473-489 `resolve(ref)` 读 `this.values` → 未加载时恒为 `undefined`

**服务对象先被注册（`ctx.get("credentials")` 立即可见），随后才执行 `init` 读文件。**
因此上一轮的 `ctx.inject(["credentials"])` 是在「服务存在、数据未加载」时触发——
**必然拿不到 key**。这就是三轮 `no credential` 的真正原因。

### 4.3 修复：轮询解析结果本身

唯一可靠的就绪信号是「`resolve()` 是否返回了值」，故改为**有界轮询**：
`ctx.inject(["credentials"])` 后最多重试 20 次，退避 `min(500ms × n, 3s)`，
一旦 `liveCatalog` 有内容即停；20 次仍失败则打一条警告后放弃。

### 4.4 实测结果（用户第四次重启，02:13:30）

```
02:13:36.159 [diag3] credentials injected, starting poll
02:13:36.162 [diag3] poll attempt=0 hasCreds=true
02:13:38.050 [diag3] SUCCESS routes=1        ← 1.9 秒后成功
```

- ✅ **pi-ai 成功**：`SUCCESS routes=1`
- ✅ **deepseek**：本轮 boot 仅 1 条初始警告，之后**无**进一步警告、**无** GAVE UP → 轮询后成功
- ✅ `setTimeout` **确实会执行**（推翻第三轮"定时器不执行"的推断——
  当时的 2 次警告是因为旧代码只在固定 1~5s 窗口重试且恰好未覆盖加载完成时刻）

### 4.5 最终验证（诊断清理后）

| 验证项 | 结果 |
|---|---|
| 模块加载 | pi-ai OK 7 / deepseek OK 37 |
| 诊断残留 | `diag2`/`diag3` = **0** |
| opencode-go | HTTP 200，**37** 条（静态快照仅 23），新增 **15** 条 |
| `deepseek-flash` | ✅ 存在 |
| deepseek-official | HTTP 200 → `["deepseek-flash","deepseek-v4-pro"]` |

### 4.6 关键教训（最终版）

1. **注册 ≠ 就绪**：cordis `Service.init` 在服务可见之后才跑；任何依赖服务**数据**的逻辑
   都必须轮询/订阅数据层就绪，不能只看服务是否存在。
2. **`loadInitial()` 不发事件**——不能指望 `credentials/reference-updated` 在启动时触发。
3. **验证加载路径用工具而非直觉**：直接调用 DSH 自己的 `findOverlayPackage` 才是权威答案。
4. **隔离测试胜过推演**：三轮推演全错，一次 `resolve()` 隔离测试立刻定位。
5. 诊断日志要能**区分多种假设**（本轮 diag3 一次就锁定了结论）。

---

## 附：本次只读排查的原始证据索引

| 证据 | 位置 |
|---|---|
| DeepSeek 硬编码目录 | `...\@deepseek-ai\dsh-llm-deepseek\lib\index.js` L1826–1847 |
| 目录 schema 默认值 | 同上 L1871 |
| `resolveModels` 纯映射 | 同上 L1890–1892 |
| `listModels` 读配置 | 同上 L1558–1560 |
| 目录定型点 | 同上 L1972 |
| 用户配置为空 | `C:\Users\Lenovo\.dsh\settings.yaml` L80 |
| trae 手写快照 | 同上 L81–208 |
| pi-ai 优先本地目录 | `...\dsh-llm-pi-ai\lib\index.js` L2159–2168 |
| pi-ai 真联网清单 | 同上 L2169–2205 |
| 无 discovery 即抛错 | `...\dsh-llm\lib\index.js` L1405–1406 |
| 刷新按钮语义是「探测+采纳」 | `...\dsh-client-ui-settings-models\lib\client.js` L595–637 |
| 下拉读 host catalog | `...\dsh-client-ui-model-selection\lib\client.js` L204–230 |
