# FrameGeist v1.3.0 记录

## 1. 信息块行编辑器：补上 v1.0.0 迁移留下的欠账

### 1.1 问题

v1.0.0 把「品牌信息」从 text layer 迁成了引擎级 `infoBlock`（自动排版：字阶 display 1.00 /
support 0.72 / detail 0.58、按留白填满 2/3），但**编辑器没跟着迁**：

- `infoBlock` 是**模板顶层字段**（`crates/framegeist-core/src/template.rs:19-20`
  `#[serde(rename="infoBlock")] pub info_block: Option<InfoBlock>`），不是 layer；
- 迁移前的行编辑器只遍历 `l.type === "text"` 的 layer，用户看得到自动排版的信息块，
  却**改不了它的行**（增/删/重排/改层级全都够不着）。

这是 v1.0.0 之后唯一一处「界面上看得见、点不动」的功能缺口。

### 1.2 实现（全部在 `web/app.js`，复用既有 `#lineEditor` 卡片）

关键设计：**不新增卡片、不改 `web/index.html`**。信息块只是行编辑器里的一个额外分组。

- 常量（`app.js:1200-1212`）：`INFO_BLOCK_KEY = "infoBlock"`、
  `INFO_ROLES = [["display","exifEdit.roleDisplay"],["support","exifEdit.roleSupport"],
  ["detail","exifEdit.roleDetail"]]`、`INFO_MIN_LINES = 1`、`INFO_MAX_LINES = 3`
  ——上下限直接对齐引擎校验 `template.rs:1398 validate_info_block`（lines 必须 1–3 条、
  `role ∈ {display,support,detail}`）。
- `buildLineEditor()`（`app.js:1213-1341`）的内部 `group(label, key, items, opts)` 新增三个可选参数：
  - `opts.roles` 非空 ⇒ 每行追加 `<select class="info-role">`，默认选中 `item.role ?? "support"`，
    改动写回 `{...item, role}`；
  - `opts.min` ⇒ 行数触底时 ✕ 禁用（**引擎不接受 0 行**，UI 不给用户造非法状态的机会）；
  - `opts.max` ⇒ 行数触顶时「添加」按钮 `disabled` 并把 `title` 设为 `t("exifEdit.maxLines")`
    （**引擎不接受 >3 行**）。
- 文本框改字时会**保留语义 role**（`next[idx] = item.role ? {...rebuilt, role: item.role} : rebuilt`），
  避免用户改个错别字就把「主标题」降级成「副标题」。
- 分组渲染（`app.js:1317-1324`）：`if (ib?.lines?.length) group(t("exifEdit.infoBlock"), …)`
  —— 模板没有信息块就不出现该分组。
- 生效路径（`app.js:393-416` `effectiveTemplateJson()`）：`__fgEditor.applyEdits` → text layer
  edits → **405 行** `if (clone.infoBlock?.lines && edits[INFO_BLOCK_KEY]) clone.infoBlock.lines = edits[INFO_BLOCK_KEY];`
  —— 编辑存进既有 `LS.lineEdits`（按 templateId 归档），`#resetLines`（`app.js:2521`）一并清除。
- 字段 chip（`#fieldChips`，`EDITABLE_FIELDS` 10 项）共用，点击插入到当前聚焦的输入框
  ⇒ 信息块行同样能一键插入 `{model}` 之类的占位符。
- i18n 新增 6 键（`exifEdit.infoBlock/role/roleDisplay/roleSupport/roleDetail/maxLines`），
  zh/en 各 530 键对齐。
- 样式：`web/styles.css:419-426` 新增 `.line-item select.info-role`（26px 高、11px 字号、
  7px 圆角、跟随 `--border` 体系），与行内 26×26 的 `.mini` 按钮同高。

### 1.3 测试

`tools/e2e-audit.mjs` 新增第 82 项（6 个断言，插在 v1.0.0 typography 之后、watchdog 之前）：

- 行编辑器里 `.info-role` 下拉数 == 模板 lines 数；
- 三个 role 选项文案都走 i18n（不以 `exif.` 开头）；
- 改 role 落进 `effectiveTemplateJson().infoBlock.lines`；
- 改 role 让 `RENDER_HASH` 像素变化（证明真的重绘了，不只是改了数据）；
- ↑ 重排确实交换了两行；
- 连点「添加」到 3 行后按钮变 `disabled`（UI 与引擎上限一致），新增行默认 `role:"detail"`；
- `#resetLines` 把 lines 与像素哈希一起还原。

## 2. `import-brand-inbox --accent`：把 v1.2.0 的承诺兑现

### 2.1 问题

v1.2.0 的发布说明与 `AGENTS.md` 都写着「素材到位后跑 `import-brand-inbox --accent`
一次上色」——**但这个参数当时并不存在**。全仓库只有硬编码
`const SERIES_ACCENT = { "nikon-s": "#FFE100" }`（v1.1.0 的 ruling 5），
`nikon-s.accent` 一直只是 manifest 元数据，画面上从未生效。

### 2.2 实现（`tools/import-brand-inbox.mjs`）

- `ACCENT_CLI`：解析 `--accent slug=HEX,…`（只接受 `/^#[0-9a-fA-F]{6}$/`，非法项 warn 后忽略）。
  优先级：`ACCENT_CLI[slug] ?? primary.accent（素材自带元数据）?? SERIES_ACCENT[slug]`。
- `monochromeShare(png)`：**只在素材本身是单色时**才允许生成 accent 面
  （取不透明墨迹像素的均值色，距离 ≤32 的像素占比 ≥ `MONO_SHARE = 0.95`）。
  这条护栏的意义是：不给双色/插画素材强行套一个颜色，否则 `-accent` 会变成「二选一」的假资产。
- 分支顺序：`skipTints`（整幅不透明徽章，加色就成一块纯色）→ `skipped-opaque-badge`；
  非单色 → `skipped-not-monochrome(XX.X%)`；否则用**同一个 `emit()`/`place()`/同一 ink 盒、
  同一 `MAIN_H`** 生成 `<slug>-accent.png`，因此几何与 base 必然逐像素一致（只换颜色）。
- 报告新增 `accent` + `accentFace{hex, asset, method}`；manifest 写入 `item.accentAsset = true`
  （不存在时 `delete`），而纯元数据的 series accent 口径保持不变。
- ⚠️ 坑：`--accent` 必须由**父进程转发给 `--render-one` 子进程**（v1.2.0 引入的渲染隔离），
  否则子进程根本没收到参数 —— 已实测验证转发路径。

### 2.3 端到端证据（真实像素）

`node tools/import-brand-inbox.mjs` 全量 apply 产出**第一个真实 accent 资产**
`templates/assets/series/nikon-s-accent.png`：base `-mono` `-light` `-accent` 四面几何完全一致
（`canvas=512x512, ink=512x112, padY=200/200`），不透明像素为单一色 `255,225,0` = `#FFE100`
（17967 px，抗锯齿落在 alpha 通道，故无杂色）。manifest 只多一行 `"accentAsset": true`，
`brand-colors.json` 零改动（22 个品牌资产幂等）。

因为仓库里**没有任何模板引用 series 徽标**，样片/基线无法证明它生效，于是用合成模板走 CLI 实测：

| 场景 | 输出像素 |
|---|---|
| 深底 `#101418` + 模板显式 `contrast:"color"` | `#FFE100` exact **604 px** / 容差内 1111 px（占画布 0.174%）→ accent 上屏 |
| 深底 `#101418`，**不给任何提示** | 与上一行**逐项相同** ⇒ 3:1 门禁自动放行，模板作者无需写 `tint`/`contrast` |
| 浅底 `#F2F2F2` | exact **0** px / 容差内 0 ⇒ accent 被拒，回退 mono/light ⇒ 门禁真在把关 |

（探针：`target/probe-accent-scan.mjs` + 三个 `target/probe-accent*.json`；教训：徽标在高分辨率
画布上才有可判定的墨迹像素，320×214 的小图只有 1–12 px 命中，探针必须用大图。）

## 3. ★ Web 宿主只注册两个面：accent / mono 在浏览器里是死代码

`web/app.js:1475-1502` 的 `ensureBuiltinAssets()` 是 Web 端**唯一**的内建资产注册点
（WASM 没有文件系统，只能靠宿主把字节喂进 `engine.register_asset`）。它的变体列表只有：

```js
for (const variant of ["", "-light"])   // ← 修复前
```

于是：

1. **v1.2.0 新增的 `-accent` 面在浏览器里永远拿不到**（`BadgeAvailability.accent` 恒 false），
   引擎里那条 Accent 分支只在 CLI（走磁盘回落）下可达 —— 页面上是死代码；
2. **v0.9「彩色主资产对比 <3:1 自动回退黑白」依赖的 `-mono` 面同样没注册**，
   策略落到「兜底 Primary」，仍用彩色，与 v0.9 的口径不符。

修法：抽 `const BUILTIN_FACES = ["", "-light", "-mono", "-accent"]` 并遍历它，
靠既有的 `if (!res.ok) continue` 让不存在的面静默跳过（磁盘面矩阵：brand/lockup 有 base+mono+light，
series/game 有 base+light，除 nikon-s 外无 accent —— 缺面即空槽是既有设计）。
E2E 第 83 项用 `performance.getEntriesByType("resource")` 断言 base/-light/-mono 都被真实请求。

## 4. 门禁变化

`tools/check-brand-colors.mjs` **268 → 275 项**，新增三项 accent 契约（遍历
`MANIFEST.groups` 里所有带 `item.accent` 的条目）：

1. `accentAsset` 与 `-accent` 文件存在性**双向一致**（声明有却没有 / 没声明却有都算失败）；
2. `accentAsset` 时 accent 面与 base 面**几何完全一致**（ink + padX + padY 三项相等）——
   这是「纯上色、几何不变」的机器可判定形式；
3. accent 面像素色 = 声明色（`hexToHue` + `hueDistance ≤45` + `meanSat ≥0.2`）。

> 踩坑：几何比较最初写成 `accent.ink === base.ink`，因 `ink` 是对象而引用不等，271 项里挂了一项；
> 改为 `JSON.stringify(ink)` 后通过。

## 5. 文档

- `docs/CREDITS.md`：nikon-s 的 accent 面已真实上屏（v1.1.0 起第一次生效），补记来源与取色依据。
- `docs/releases/v1.3.0.md`、`AGENTS.md` v1.3.0 横幅。

## 6. ★ 新门禁：`web/` 与 `templates/assets/` 镜像一致性

浏览器从 `web/<kind>/` 取徽标面（`BASE = new URL(".", document.baseURI).href`，app 挂在
`/web/` ⇒ 实际请求 `/web/series/…`），而 `web/<kind>/` 是**手工镜像**，此前既没有工具
也没有门禁同步。实测故障：accent 面在磁盘上存在，但 `/web/series/nikon-s-accent.png` **404**
（E2E 首轮就是因此失败）；HTTP 探针 `/templates/assets/series/nikon-s-accent.png -> 200`。

`tools/check-brand-colors.mjs` 因此新增 4 项：遍历 `brand/lockup/series/game`，用
`readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile() && e.name.endsWith(".png"))` 取
文件名集合（自动排除 `thumbs/`），**双向比对** `templates/assets/<kind>` 与 `web/<kind>`，
`missing`（磁盘有、web 无）与 `orphan`（web 有、磁盘无）都必须为空。

门禁立刻抓出两处真实问题，均已修复：

| 问题 | 来源 | 处置 |
| --- | --- | --- |
| `missing=["nikon-s-mono.png"]` | v1.1.0 导入官方 Nikon S 素材时生成的 mono 面从未镜像 | 补进 `web/series/` |
| `orphan=["canon-rf-l-light.png","canon-rf-l.png"]` | v1.1.0 按裁决 6 从 manifest 与 `templates/assets/series/` 移除，却漏了 `web/` | `git rm`（已确认 app.js / index.html / e2e 零引用） |

> 新增纪律：**任何新增/删除 `templates/assets/<kind>/` 下的徽标面，必须同步 `web/<kind>/`**，
> 否则 CLI 能渲染、浏览器拿不到，且没有任何现有门禁会报警。

## 7. 全量门禁（全绿）

- ✅ `validate-templates --all`：192 ok / 0 failed
- ✅ `cargo fmt --all --check`；`cargo clippy --workspace --all-targets -- -D warnings`
- ✅ `cargo test --release --workspace`；三 cross target（wasm32 / aarch64-android / aarch64-ohos）
- ✅ `tools/wasm-build.mjs`：`WASM_EXIT=0`，smoke **帧字节一致**、collage 在 PRD N2 像素门内
- ✅ JS 门禁：i18n **530/530**、品牌色 **275/275**、UI 对比度全过、字形 192 套 279 对 0 缺、
  UTF-8 960 文件 0 破损、照片唯一性全绿
- ✅ 样片 `gen-samples`：192 套 / 576 张，failed=0（跑完 `git checkout` 掉 92 个二进制漂移）
- ✅ 视觉基线：**384/384 全部在容差内（hamming ≤10，meanΔ ≤2.5）** ⇒ **零漂移，未使用 `--update`**
- ✅ 对比图 `docs/reports/v1.3.0/compare`：**25 类 / 150 组**（before 侧取 v1.2.0 本地提交 `1a5e189` 的
  192 张预览，不是 `HEAD`——`target/extract-before-samples.mjs` 默认取 HEAD 会拿到 v1.3.0 自己）
- ✅ **E2E 297/297**（真实 CDP 输入；新增第 82 项信息块行编辑器 6 断言 + 第 83 项宿主徽标面 3 断言）
- ✅ **perf 4/4**：24MP 预览 171 ms / 导出 566 ms；60MP 预览 303 ms / 导出 1453 ms
- ⏳ 桌面端重建 + CDP 探针 9/9（版本 1.3.0）

### 7.1 E2E 迭代中被测试自身绊倒的两处（记录以免重犯）

1. **陈旧 DOM 引用**：信息块行编辑器每次写入都会 `buildLineEditor()` → `#lineEditor.innerHTML=""`
   整体重建，探针若跨 mutation 持有节点引用，后续读到的是游离节点上的旧按钮。
   修法：所有 helper 每次都重新 `group()` 查询。
2. **不能用 `performance.getEntriesByType("resource")` 断言注册**：`builtinAssetCache` 按 slug 去重，
   先跑的测试已经把资源取过，后测拿不到新的网络条目；徽标库缩略图还会混进同一路径前缀。
   修法：新增 `window.__fg.registeredBuiltinAssets()` 作为可断言的事实来源。

## 8. 发布记录

- 本地提交链：`3b8bb76`（accent 链路 + 宿主面修复 + accent 资产）→ `e1e8991`（行编辑器 + E2E + 版本号 1.3.0 + 镜像门禁 + 文档）→ `4d0e887`（门禁数字）→ `6c19966`（门禁数字校正 275）。
- Git Data API 推送：remote-base `37e78f5` → 远端 `main` = `81c4d02`（标签提交）→ 文档修正后 **`b561880`**。
- 标签 `v1.3.0` → **`81c4d025f97c5abf7875a76a507811a5d1a61aac`**（轻量标签，`POST /git/refs` 单层参数；
  注解标签接口 `POST /git/tags` 在本机仍被服务端 422 拒绝，证据同 v1.2.0 §8）。
- 工作流全绿：tag 推送 → ci `36948301974` ✅ / release `36948301971` ✅；main 推送 → ci `36950898746` ✅ /
  pages `36950898812` ✅；另手动 `workflow_dispatch` pages `37111266314` ✅。
- Release：https://github.com/meihuaanying/framegeist/releases/tag/v1.3.0

  | 资产 | 字节 | sha256 |
  | --- | --- | --- |
  | `framegeist-cli-v1.3.0-win-x64.zip` | 77,503,267 | `c7e45454d76d642519186ad3b031b2b9d80b42c744e0d92103f036b3fd9755de` |
  | `framegeist-desktop-v1.3.0-win-x64.zip` | 101,355,610 | `53d3c3471b45b943eae0214f771922fdbf88e7158e31bc95b14602ad7ad379d1` |
  | `FrameGeist-v1.3.0-win-x64-setup.exe` | 101,334,915 | `2b71c61f036119d9aaacde05a338b594a9d10e81046a36578dc362d307bc8f5d` |
  | `framegeist-templates-v1.3.0.fgpkg` | 20,674,803 | `dd67fe84551a4d70fe0a213b7bc1f160b0b6cf44b646529e2a6b36e8f4180720` |
  | `SHA256SUMS.txt` / `update.json` | 406 / 1350 | — |

  **四项 sha256 与体积在 `SHA256SUMS.txt`、`update.json`（`latest.platforms` 三项 + 顶层 `templates`）、
  以及 asset `digest` 三处完全一致** ✅；说明已用 `gh release edit --notes-file` 注入 **2992 字符**。
  （`update.json` 的模板条目在**顶层** `templates` 字段，不是 `latest.templates`。）

### ⚠️ 未闭环：GitHub Pages 线上仍是 v1.2.0

**现象**：站点 https://meihuaanying.github.io/framegeist/ 仍返回 v1.2.0 的内容 ——
`web/app.js` 里 `APP_VERSION = "1.2.0"`、`web/sw.js` 缓存名 `framegeist-1.2.0`、
`web/brand/index.json` 的 nikon-s 无 `accentAsset`；并且 v1.3.0 新增的
`web/series/nikon-s-accent.png` **404**，而本版已删除的 `web/series/canon-rf-l.png` 仍 **200**。

**已排除的可能**（逐项实测）：
- 不是 CDN 延迟：距部署创建已 **31 小时**（10-02 01:25Z → 10-03 08:51Z），期间每 2 分钟轮询 20 次，
  加随机 query 绕过缓存，结果不变；
- 不是工作流失败：三次部署（tag 推送、main 推送、`workflow_dispatch` 手动）全部 `success`；
- 不是部署没创建：`deployments` 里有 `6799075261`（10-02 01:25Z）与手动重跑的 `6825584638`
  （10-03 08:54Z），sha 均为 `b561880…`，`deployments/statuses` 最终态均为 `success`；
- 不是 payload 指错：`deploy-pages` 日志显示
  `Creating Pages deployment with payload: { artifact_id: 11270032584, pages_build_version: "b561880ce31f…" }`
  并 `Reported success!`；
- 不是 Pages 配置异常：`build_type = workflow`、`source = { branch: main, path: "/" }`、
  `github-pages` 环境 **0 条保护规则 / 0 个 reviewer**；
- 不是 `site/` 目录冲突：仓库 `site/` 下**不存在** `web/`，所以
  `cp -r site/* upload/` 后再 `cp -r web upload/web` 不会套娃成 `upload/web/web`。

**结论**：GitHub 侧接受了部署并回报成功，但未把新产物切到线上（站点仍指向 v1.2.0 那次部署，
即 10-01 18:47Z 的 `37e78f5`）。这是仓库之外的问题，本机无法进一步推进；
`.github/workflows/*` 按项目纪律禁改，且当前 token 也无 `workflow` scope。

**影响范围**：网页版用户暂时仍拿到 v1.2.0；**桌面端与 Release 完全不受影响**（两者都已验证 1.3.0）。
**后续动作**：等服务端恢复后重跑一次 `gh workflow run pages.yml --ref main`，
再用两个信号确认落地 —— `web/series/nikon-s-accent.png` 返回 200 且
`web/series/canon-rf-l.png` 返回 404（这两个信号对缓存与版本都唯一）。

## 9. ⚠️ 更正：本节对 Pages 的归因是错的（2026-10-04）

§8 把「Pages 线上仍是 v1.2.0」归因为 GitHub 侧未切换部署。**这个结论不成立，真实原因在本地。**

`tools/gh-api-push.mjs` 上传的增量是 `git diff <local-base> <target>`，然后叠加到远端基线树
上；而我在 v1.3.0 的两次推送里都把 `local-base` 写成了一个**从未推送过**的本地 commit
（第一次 `3b8bb76`、第二次 `e1e8991`）。工具当时**不做任何校验**，于是只上传了最后那一小段增量，
把 `3b8bb76` 里的内容整体丢弃——包括 `web/app.js`、`web/series/nikon-s-accent.png`、
`templates/assets/series/nikon-s-accent.png`、镜像门禁与 accent 契约。

远端树因此停在 v1.2.0 的内容，**Pages 忠实地部署了它**。所有工作流仍然 success（它们不校验树内容），
部署记录也真的 success（payload 的 sha 正确，只是那个 sha 的树本身是残缺的）。
我据此排除掉 CDN 延迟、工作流失败、环境保护、`site/` 冲突……却漏了「远端树本身就不对」这一种可能，
因为所有证据都在自洽地指向服务端。

第二个独立缺陷同期也在起作用：工具从**工作区**读字节上传，而 Windows 工作区是 CRLF，
因此凡是用编辑器/脚本改过的文件，其 blob sha 与提交内容不同 —— 远端树**永远不可能**等于目标树。

**工具已加固**（`e066793`，见 `tools/gh-api-push.mjs`）：
① 通过 API 校验分支 head 仍等于给定 base（`git ls-remote` 在本机不可达）；
② blob 一律用 `git cat-file blob <target>:<path>` 从 git 读取；
③ 构造出的根树必须与目标树一致，否则**在移动分支之前**中止并列出差异路径
   （workflow 文件仍按既有约定跳过，因 token 无 `workflow` scope）；
④ 新增 `--include=a,b`，用于修复被早期不完整推送留下中间态 blob 的路径。

**教训**：推送链路的门禁必须校验「结果」而不是「过程」——本次所有既有信号（工作流 success、
部署 success、sha 正确）都通过了，唯独「远端树 == 本地目标树」这一条能发现它。
这条校验现在就是工具的一部分。
