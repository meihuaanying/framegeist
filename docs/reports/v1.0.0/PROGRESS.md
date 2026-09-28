# v1.0.0 进度日志

> 依据：`docs/V1.0.0-CONSTRAINTS.md`（本文件只记录事实，契约冲突时以契约文件为准）。
> 记录规则：每完成一步，写清「做了什么 / 证据 / 结论 / 下一步」。

## Step 0 — 环境核查（已完成）

- 仓库 `D:\FrameGeist`，起始 HEAD `3dc0ba0`；工作区仅新增未跟踪的 `docs/V1.0.0-CONSTRAINTS.md`。
- 静态服务 8350 已在跑；无头 Edge（CDP 9237，profile `%TEMP%\fg-edge5`，Edge 153.0.4234.48）按需启动。

## Step 1 — v0.9.4 坐标 / 点选热修（进行中）

### 1.1 根因（契约 §0 P1–P4，均有实测证据）

1. **坐标事实来源分裂**：wasm `layer_boxes` 按全分辨率画布算盒（实测 2868×2219），而舞台显示的是 `fastPreviewRgba`（长边 cap 1600）渲染的预览帧（1792×1387）→ 识别框偏移约 1.6 倍、真实鼠标点不中、旧的自动平移把画布推出屏幕。
2. **旧 E2E 假通过**：合成 `PointerEvent` + 与 `canvasToLocal` 相同的错误映射推导坐标，自洽 → 测不出上述 bug。
3. **形状层盒与渲染器不一致**：`boxes.rs` 的 `Layer::Shape` 用硬编码尺寸，与 `render.rs::draw_shape_layer` 的规则不同 → bar/bar-dot 等盒完全错位。
4. **重渲窗口吞点击**：`renderNow` 用 `withViewTransition` 包住 `setStage`，过渡快照期间真实鼠标命中测试返回文档根元素（非 `#viewport` 子树）→ 首次点击丢失；`setStage` 每次 `wrap.innerHTML=""` 又销毁 overlay/img，加重该问题。

### 1.2 引擎改动（已落地，`cargo check` 通过）

- `crates/framegeist-core/src/boxes.rs`
  - 新增 `canvas_frame(geo, overrides) -> (u32,u32)`（aspect 扩展公式的唯一来源）。
  - 新增 `layer_boxes_frame_json(photo, template, opts) -> {"frame":[w,h],"boxes":[...]}`（单次 decode + probe）。
  - `layer_boxes_json` 改为委托 `layer_boxes_in_frame`（只序列化 boxes）。
  - `canvas_size_for_photo` 改用 `canvas_frame`（修掉忽略 aspect 扩展的潜在不一致）。
  - `Layer::Shape` 分支改为完全镜像 `draw_shape_layer`：默认尺寸 Line (0.2,0.0015)/Rect (0.2,0.2)/其他 (0.05,0.05)；`sw/sh = size.* × 照片尺寸`；`span:"auto"` → inset = margin×照片宽（默认 0.06）；`frame` 角色 → margin 矩形。
- `crates/framegeist-wasm/src/lib.rs`
  - `layer_boxes(photo, template_json, overrides_json, max_edge)` → 返回 frame+boxes；`canvas_size(..., max_edge)`；`max_edge == 0` → 全分辨率。
- `crates/framegeist-cli/src/main.rs`：`Cmd::Boxes` 改用 `layer_boxes_frame_json`（单次 decode），输出格式不变。
- 验证：`cargo check -p framegeist-core -p framegeist-cli` EXIT=0；`cargo check -p framegeist-wasm --target wasm32-unknown-unknown` EXIT=0；`node tools/wasm-build.mjs`（smoke: frames byte-identical）并重建 `web/pkg`。

### 1.3 Web 改动（已落地）

- `web/app.js`：`PREVIEW_MAX_EDGE = 1600` + `displayMaxEdge()`；`fastPreviewRgba` 用该 cap（`Math.ceil` 与 Rust 舍入一致）；删除 `panIntoView()`；`setStage` 双缓冲重写（复用 `#canvasWrap img`，`img.onload` 后才 `shown`/`updateStageSize`/`fitStage`/`onStageLoaded`，`stageSeq`/`stagePainted` 供测试等待）；`renderNow` 去掉 view transition；新增 `#locateSel` 监听；`__fg` 导出 `applyZoom/displayMaxEdge/previewMaxEdge`。
- `web/editor.js`：`S.boxFrame`；`refreshBoxes()` 走 4 参 `layer_boxes(..., displayMaxEdge())` 并解析 `{boxes,frame}`；`imgRect()`/`canvasFrame()` 以 `boxFrame` 为准；删除全部选中自动平移；新增 `locateSelected()`（居中 + 仅把选中盒 clamp 在视口内，margin 24px）；`onStage` 精简 + 新增 `onStageLoaded`（新帧上屏后才刷新盒子）；`__fgEditor` 导出 `boxes/boxFrame/selection/hitAt/boxClientRect/refreshBoxes/locateSelected`。
- `web/styles.css`：选中框 `calc(1.5px * var(--inv-zoom,1))`。
- `web/index.html`：新增 `#locateSel`（`stage.locate`）。
- `web/i18n.js`：4 locale 新增 `stage.locate`。

### 1.4 真实输入探针（`target/probe-realclick.mjs`）

- 全 CDP `Input.dispatchMouseEvent`：**13/13 PASS**。
- 覆盖：frame==渲染像素；preview cap 1600；7/7 层真实点击命中；选中不改变 zoom（无自动平移）；overlay 盒与 `boxClientRect` 对齐（±3/±6px）；空白处清除选中；locate 按钮可用并能在 scale 4 下把选中拉回视口；export 路径 frame==渲染尺寸且真实点击可选；真实拖拽位移符合预期（吸附容差 10px）。

### 1.5 E2E 升级（`tools/e2e-audit.mjs`）

- 新增真实输入辅助：`mouse/clickAt/dblClickAt/dragAt`、`waitStage`、`dragAndWait`；注入 `window.__fgBoxes(maxEdge)` / `__fgBoxesFrame(maxEdge)`（4 参 API，`0` = 全分辨率）。
- 12 处旧 3 参 `layer_boxes` 全部升级；合成事件画布交互（拖动吸附、free collage 拖动、双击进裁剪、吸管、裁剪框拖动、插入图拖动、handle 移动/缩放/旋转、pass-through、锁定、平移）全部改为真实 CDP 输入。
- 检查数 274 → 276（新增「选中不改 zoom」与「locate 拉回选中」）。
- 已知探针侧修正：free collage 拖动改为抓取**最上层**盒并按位移识别被拖动项；插入图拖动起点改为距盒边 ≥30 屏幕像素（避开 24px 手柄）；pass-through 等待模板切换真正落地后再取盒。

### 1.6 真实输入之外的三个鲁棒性修复（E2E run4 定位）

1. **waitLabel 基线失效**：页面在 `fg-theme` 切换（audit 第 513 行）与 locale 测试（第 734 行）各重载一次，页面侧 `renderReq/renderDone` 从 0 重数，而 Node 侧 `lastRenderReq` 保持旧值 → 之后每次等待白烧超时（run4 的 collage 段 30s+60s）。
   修复：`waitLabel` 改用 `state.renderReq/renderDone` 计数器判新鲜（`renderNow` 入口自增 req，`finally` 仅在未被取代时写 done），并在 `s.req < lastRenderReq` 时自愈归零；看门狗 15 → 18 分钟。
2. **渲染 blob 泄漏 → 渲染进程 OOM**：`renderNow` 每次 `createObjectURL` 从不释放，长时间全量 E2E 累积数 GB，导致无头 Edge 整体退出（run3 看门狗 + AVIF 三项级联失败）。
   修复：`setStage` 在新帧 `onload` 时 revoke 上一帧 blob（`state.stageUrl`；`onerror` 同样释放），灯箱 `setLbSrc` 同理。
3. **浏览器命中测试过期吞事件**：重负载更新后，真实 `pointerdown` 会短暂投递给文档根 `HTML`（非 `#viewport` 子树）→ 舞台监听器收不到，拖拽静默失效（`probe-collage` 录制器实测 `tgt:"HTML"`，随后自行恢复）。
   修复：舞台 `pointerdown` 监听从 `#viewport` 改为 **window（capture）**，由应用自身用 `#viewport` 的 client rect 做落点判定，并用 `document.elementFromPoint` 复核是否落在 `.handle`/`.crop-rect` 上；`stageImg()`（跨渲染取当前舞台 img）替换对 `S.img` 的缓存引用；`imgRect()` 允许 `naturalWidth` 瞬时为 0（改用 offset 尺寸 + `boxFrame`）。

### 1.7 全量门禁证据（Step 1 验收，全部绿色）

- **E2E**：`target/e2e-run5.log` → **276/276 PASS，EXIT=0**（真实 CDP 输入；无看门狗、无页面异常）。
- **E2E 回归修复（run6 → run7）**：`stageMatchesFrame()` 新增后 run6 出现 5 项 free-collage 失败——`layer_boxes` 在拼贴模式不适用（`S.boxFrame` 为 null），守卫误判为「帧不匹配」而清空叠加层。修复：free 模式改用 free spec 与舞台图尺寸比对（`img.naturalWidth/Height === spec.width/height`）。验证：`diag-freeguard` 在 free 模式 `stageMatches=true`、overlay 盒 3 个；`probe-collage` 真实拖拽位移 0.04/0.0267 ✓。
- **E2E 回归修复（run8 → run9）**：run8 在 free-collage 之后的**模板帧交互全部失败**（8 项：插入图拖动、四角手柄/工具条、拖动、缩放、旋转、删除撤销、locate、穿透循环）。根因：`state.freeCollage` 是**残留开关**（审计只把它打开、从不关闭），切回 `modeFrame` 后守卫仍走 free 分支 → 与模板帧尺寸比对失败 → 叠加层清空、点选早退。修复：守卫改为检查**有效模式**（`st.mode === "collage" && st.freeCollage`，与渲染路径同语义）。验证：`diag-freemode` —— free 关闭后切模板 `stageMatches=true`、boxFrame/舞台 1600×1302、overlay 盒 3 个、真实点击选中 `brandmark` ✓；run9 复跑中。
- **桌面端（WebView2，CDP 9333）**：`target/probe-desktop.mjs` **9/9 PASS** — boot ready / 版本 0.9.4 / 192 模板 / 渲染帧与盒一致（1792×1560）/ 真实点击选中 `bar` / 选中不改变缩放平移 / 「定位到选中」按钮存在且能把选中拉回视口。截图 `target/desktop-1-wall.png`、`target/desktop-2-editor.png`。
- **perf 4/4**：`target/perf-run6.log` → 24MP 预览 488ms / 导出 1733ms，60MP 预览 581ms / 导出 3481ms（全部低于阈值）。
- **Rust**：`target/gates-rust.log` → fmt / clippy（`-D warnings`）/ `cargo test --release --workspace`（含 golden 回归）全部 EXIT=0。
- **多目标**：`target/gates-targets.log` → wasm32-unknown-unknown、aarch64-linux-android、aarch64-unknown-linux-ohos 三条 `cargo build --release` EXIT=0（+ 宿主 win）。
- **wasm**：`node tools/wasm-build.mjs` 重建后 smoke 报告帧字节一致（体积 5,061,848 B）。
- **JS 七项**：check-i18n 487/487；check-brand-colors 169/169；check-ui-contrast 通过；check-glyph-coverage 192 模板 / 355 对 / 0 缺失；check-utf8 928 文件 / 0 破损；check-photo-uniqueness 通过；validate-templates `--all` 192 ok / 0 failed。
- **样片与基线**：渲染管线未改动（Rust golden + wasm smoke 双重证据），`gen-samples` 重渲 192/192 与 `visual-regression` 检查零差异（见 `target/gates-assets.log`）。
- **版本号**：四处已升 0.9.4（`Cargo.toml` / `tauri.conf.json` / `web/app.js` / `web/sw.js`）。

### 1.8 待办（Step 1 收尾）

- [x] E2E 全量复跑至 276/276。
- [x] perf 4/4 复测（24MP / 60MP）。
- [x] 版本号 0.9.4（四处）。
- [x] 样片/基线零差异确认。
- [x] 文档（AGENTS.md 发布横幅 / 发布说明定稿）。
- [x] 提交推送 + tag v0.9.4 + Release 六资产 + Pages 验证 + 桌面端重建验证。

### 1.9 发布记录（v0.9.4，2026-09-24）

- 本地提交 `b8aaeae`（`fix(v0.9.4): unify canvas geometry, real mouse picking, drop auto-pan`）→ Git Data API 推送（diff 34 entries）→ 远端 `main` = `7d09ad0`。
- 注解标签 `v0.9.4` → tag object `0642e31`；Release：https://github.com/meihuaanying/framegeist/releases/tag/v0.9.4
- 工作流：main `ci` **35965718511** ✅ success；`pages` **35965718565** ✅ success（线上 `APP_VERSION 0.9.4`、`framegeist-0.9.4`）；`release` **35965788941** ✅ success（六资产齐全）；tag `ci` **35965788978**（4/5 job success，`test + clippy (windows)` 的「render template sample wall」步骤仍在跑）。
- 六资产：`framegeist-cli-v0.9.4-win-x64.zip` 74.02 MB / `framegeist-desktop-v0.9.4-win-x64.zip` 94.38 MB / `FrameGeist-v0.9.4-win-x64-setup.exe` 94.17 MB / `framegeist-templates-v0.9.4.fgpkg` 19.75 MB / `SHA256SUMS.txt` / `update.json`（templates count 192）。
- 哈希一致性：SHA256SUMS 四项（`3bbfe0fc` / `0f8ac370` / `81fa2b18` / `90d3fa04`）与 update.json 的 `win-x64-cli` / `win-x64` / `win-x64-installer` / `templates` 完全一致 ✅。
- Release 说明：远端 `release.yml` 未含 notes-file 改动（workflow scope 限制），已按惯例手动注入 `gh release edit v0.9.4 --notes-file docs/releases/v0.9.4.md` ✅。
- 桌面端门禁：重建后 `probe-desktop.mjs` **9/9** ✅（应用保持运行）。

### 1.10 Step 1 结论

v0.9.4 热修全部完成：坐标单一事实来源、真实鼠标点选/拖拽、取消自动平移 + 定位按钮、显示帧一致性守卫、blob 释放、真实输入 E2E **276/276**、perf 4/4、桌面端 9/9、六资产发布 + Pages 验证。

## Step 2 — v1.0.0-A 竞品调研（已完成，2026-09-24）

- 交付：`docs/reports/v1.0.0/RESEARCH.md`（8 家竞品逐一拆解 + 9 方对比总表 + 10 条可吸收结论 C1–C10）与 `docs/reports/v1.0.0/IMPROVEMENTS.md`（P1–P8 提案，含收益/成本/风险/红线）。
- v1.0.0 拟实施三条低成本高收益提案：**P3 快捷键增强 + 速查表**、**P1 导出预设**、**P2 批量导出命名规则**（顺序 P3 → P1 → P2）；其余入 v1.1 backlog。
- 红线：只动 `web/` UI 与设置组装层，不改 `crates/`、模板 JSON、渲染语义；i18n 4 locale 同步；每提案新增 E2E ≥2 条。

## Step 3 — v1.0.0-B 设计语言 v3 + 引擎拟合能力（待开始 → STOP 1）

- 引擎：`info_block`（side / fields / 2/3 拟合 / ≤3 行 / 字号求解）、DESIGN-LANGUAGE v3、5–8 套样张；完成后 **STOP 1 等用户审核**。
- 已启动排版侦察（explore 子代理）：渲染文字链路、schema 字段、留白表达、v0.9 排版约定、侧向分布统计、相关测试基线。

### Step 3 完成记录（2026-09-24）

- **引擎能力（已落地 + 测试 5/5）**：`InfoBlock` schema（`crates/framegeist-core/src/template.rs`，serde 名 `infoBlock`；`side` / `font.family` / `font.weight` / `lines[]`(expr,fallback,role) / `align` / `fill` / `sizeMin` / `sizeMax` / `lineHeight` / `color` / `z`）+ 校验 `validate_info_block`（≤3 行、单侧、extend + 该侧 padding>0 等）；共用求解器 `crates/framegeist-core/src/text_fit.rs`（角色字阶 display 1.00/600/−0.02、support 0.72/400/0、detail 0.58/400/+0.08；2/3 拟合；行距 =（lineHeight−1）×字号；clamp sizeMin 0.0095–sizeMax 0.12）；渲染 `render::draw_info_block`（z 语义接入 order 循环、legacy 模式跳过、auto 对比色）；几何 `boxes` 追加 `info-block` 盒 + 逐行子盒（`info-block-<i>-<role>`）。
- **测试**：`crates/framegeist-cli/tests/engine_v100.rs` **5/5**（下侧 2/3 ±5px、左 2/3 ±5px、不越界/不遮照片、boxes↔像素 ±2px、4 行/side=top/无 padding/未知 role 被拒、无 infoBlock 时留白区无墨迹 + 两次渲染字节一致）。
- **样张（STOP 1 审核件）**：`docs/reports/v1.0.0/samples/` 6 套草稿模板 + 7 张全尺寸渲染（s01-bottom-classic 横/竖、s02-bottom-hero、s03-left-caption、s04-right-rail、s05-bottom-minimal、s06-left-stack）；`node tools/validate-templates.mjs --dir docs/reports/v1.0.0/samples` → **6 ok / 0 failed**（schema + 引擎放行）；预览已展示给用户。
- **设计语言 v3 草案**：`docs/reports/v1.0.0/DESIGN-LANGUAGE-v3-DRAFT.md`（不覆盖 v2）；**§10 五个待用户裁决的问题**：(1) 下侧默认横向落点 left vs center；(2) 左右侧块垂直居中 + 块内 align；(3) 字号上限 0.12 是否够（是否要 0.16）；(4) display 行优先机型还是日期/地点；(5) 深色模板是否纳入 v1.0.0。
- **文档**：`docs/schema/template.schema.json` 增加根级 `infoBlock`（与 Rust 校验一致）；`docs/TEMPLATE-SPEC.md` 新增 §4.7 信息块 infoBlock（v1.0.0）。
- **用户指示（@1447@ 原话）**：「按计划继续推进，注意测试和检查」→ 视为样张与 v3 方向默认通过（5 问保持待裁决），继续 Step 4（47 项徽标审计 → STOP 2）。
- **兼容性**：无 `infoBlock` 的旧模板渲染字节不变（golden + 新增 opt-in 测试双重证据）。

## Step 4 — v1.0.0-C 徽标审计 + STOP 2 裁决（已完成）

### 4.1 审计交付物
- `docs/reports/v1.0.0/brand-audit.md`：47 项（camera 18 + phone 10 + series 13 + game 6）逐行对照——官方样式参考 / 来源（含可达性标注「待核实」）/ 当前实现（`web/brand/<slug>{,-mono,-light}.png` + `tools/brand-colors.json`）/ 差异 / 拟改 / 素材许可 / 风险；附录 A 官网可达性实测、附录 B Simple Icons 成员核验。
- 分类统计：保留不动 22 / 仅颜色 6 / 字形重排 19 / 待官方截图定案 24 / 口径待裁决 4；三处「标签 vs 画面」不一致（olympus、panasonic、wwmeet）与黄色徽标对比度问题（nikon/insta360 ≈1.2–1.3:1）已单独列出。
- `docs/reports/v1.0.0/brand-audit-lens.md`：Q12 扩围的 10 个纯镜头品牌补充审计（子代理产出）。
- `docs/reports/v1.0.0/brand-delivery-checklist.md`：官方素材交付清单（第一优先 21 项 = Q8；第二优先 4 个手机品牌；第三优先 10 个镜头品牌）+ 交付目录与命名约定。

### 4.2 STOP 2 十二问裁决（用户逐条答复，2026-09-24）
1. 颜色口径：**维持 Simple Icons**（6 项颜色不改，「仅颜色」类作废）。
2. 徽标形态：**使用官方标识**（用户声明有授权；官方素材由用户提供；CREDITS 记「官方标识经授权使用」）。
3. 手机品牌中文名：**仅界面显示名加中文**（画面保持官方拉丁字标）。
4. 旧品牌名：**保留 OLYMPUS / Panasonic**（画面文字不改）。
5. 系列点缀色：**全部引入官方点缀色**（13 个系列徽章 + manifest v5 + 门禁同步）。
6. Canon 系列：**只保留 L**（去掉 RF 前缀，配官方红）。
7. 游戏字标：**官方标识 + 排印兜底**（不复制官方书法/插画；中文界面可加中文行）。
8. 官方素材：**一次性提供 21 项**（交付方式与清单见 checklist）。
9. ricoh/zeiss 官方色：**授权按官网取色**（记录采样来源，写入 `brand-colors.json`）。
10. 黄色徽标：**浅底强制 `-mono`**（深色模板保留官方黄）。
11. 商标声明：**补充游戏 IP 专门声明**（CREDITS + 免责声明）。
12. 镜头品牌：**本轮一并核对**（审计范围 47 → 57 项）。

### 4.3 后续（Step 5 前置）
- 用户提供官方素材（`brand-official-inbox/`，已 gitignore）后：`gen-brand-assets.mjs` 接入 + manifest v5 + 系列点缀色变体 + 模板引用与 `check-brand-colors` 门禁同步。
- 界面层：zh-CN/zh-TW 徽章库显示名本地化；浅底自动 `-mono`；CREDITS/免责声明补充。
- 之后进入 Step 5：全量 192 套重排（info_block 迁移）+ 样片/基线/对比图重生成 + 全量门禁 + v1.0.0 发布。

## Step 5 — v1.0.0-D 全量重排 + 门禁 + 发布（进行中）

### 5.1 迁移工具与全量落地（2026-09-25）
- 工具：`tools/apply-v100-typography.mjs`（默认 dry run；`--apply` 写入；`--only <ids>`；`--force` 忽略幂等标记）。规则：焦点（字号最大）文字层决定侧向（top/middle → bottom）；≤3 行按字号排序映射角色（≥0.05 display、<0.022 detail、其余 support）；行表达式 = 该层 content 的 expr 以 ` · ` 连接；移除全部文字层、剥除指向它们的 `attachTo`；必要时画布改 extend + 该侧 padding（bottom 0.26 / left·right 0.28）+ 背景（按文字色明暗选 #FFFFFF/#101418）；`meta.version = 1.4.0`、`minEngineVersion = 1.0.0`；每套经 CLI `boxes` 几何守卫（info-block 盒在留白带内、子盒 1–3 且不越界），失败自动回滚。
- 结果：`--apply` → **migrated 192 / skipped 0 / failed 0**；侧向 bottom 189 / right 2 / left 1（侧栏保侧：calendar-rail-date-01、festival-dragon-boat-01、portfolio-vertical-scroll-01）；报告 `docs/reports/v1.0.0/typography-v100-report.json`。
- 校验：`node tools/validate-templates.mjs --all` → **192 ok / 0 failed**；pilot 6 套抽检渲染（`target/preview-v100-migrated/`，含侧栏两套）已展示。
- 界面层随迁：徽章库手机品牌显示名本地化（Q3，`brandLabel()` + i18n 10 键/语言，check-i18n 497/497）；浅底黄色强制 `-mono` 由既有 3:1 对比度门实现并有回归测试（`engine_v100.rs` 6/6）。
- 进行中：样片/预览/缩略图重渲（`tools/gen-samples.mjs`）→ 视觉基线重生成（`visual-regression --update`）→ 对比图 → JS 七项 check → E2E（同步模板相关断言）→ perf/桌面端 → 全量门禁 → 发布 v1.0.0。

### 5.2 CJK 字体修复与门禁恢复（2026-09-25）

- **真实问题**：首轮迁移把焦点层的拉丁字体当作整块字体，而合并行含 CJK 字面量 → `art-*` / `calendar-*` / `festival-*` / `magazine-*` / `portfolio-*` / `colorwalk-*` / `personal-cn-*` 等模板缺字 ✗。
- **修复**：`tools/apply-v100-typography.mjs` 的 `infoBlock.font.family` 改为「含非 ASCII 字面量的层字体优先 + 被选层字体并集（≤8）」，并删除块级 weight 覆盖（让角色字重同时作用于拟合测量与渲染）；`git checkout HEAD -- templates` 后重做迁移 → **APPLY: migrated 192 / skipped 0 / failed 0**（侧向 bottom 189 / left 1 / right 2）✓。
- **glyph 门禁**：`tools/check-glyph-coverage.mjs` 两处修复——① 入口从 `tpl.layers` 改为根遍历（收集 `infoBlock` 伪层）；② 只检查首个可用 family（与引擎 `family_for` 语义一致，消除次级 family 的假阳性）→ **192 templates / 279 family/char pairs / 0 missing** ✓（此前 0 / 35 / 157 分别是入口 bug 与假阳性）。
- **重生成**：样片/预览/缩略图 192/192（576 张）✓；视觉基线 384 ✓；对比图 25 类 / 150 组 ✓（`docs/reports/v1.0.0/compare`，before v0.9.4 左 / after v1.0.0 右）。
- **E2E 同步**：迁移后模板不再含文字层 → 新增注入助手 `window.__fgEnsureTextLayer()`（无文字行时点 `#addText` 并轮询等待），修补 4 处（check 29 预设箔金、图层重命名、EXIF 字段芯片、zh-CN i18n 属性标签；对齐/分布探针自建文字层无需改）→ 迁移后第一轮全量 E2E 已启动（`target/e2e-v100-run1.log`）。
- **待办**：E2E 结果 → perf 4/4 → 桌面端 9/9 → 全量门禁（fmt/clippy/test/四 target/wasm 帧一致/七项 check）→ 版本号四处 1.0.0 + 文档 → 发布（六资产 + Pages + 桌面端）。

### 5.3 体验三项（Step 6）与 E2E 收尾（2026-09-28）

- **Step 6 实施（P3 + P1 + P2）**：`web/app.js` 新增快捷键与速查表（`SHORTCUTS` 表：E 导出 / Ctrl+Shift+E 批量 / F 适应 / 0 100% / +− 缩放 / L 定位 / ? 速查；输入框聚焦或 Alt 按下时不触发）、导出预设（4 内置 + 自定义，写回 `#exportSize`/`#exportFormat`，导出栏显示「预设名 · 格式」）、批量导出命名对话框（token `{name}{tpl}{tplName}{date}{seq}{size}{fmt}` + 实时预览 + 冲突策略 sequence/overwrite/skip）；`web/index.html` 加 `#presetChips`、`#exportMulti`、设置「导出预设」节；`web/styles.css` 加 `.sc-overlay/.sc-card/.sc-row/.name-preview`；`web/i18n.js` 524/524。
- **真实页面探针**（`target/probe-step6.mjs`，CDP 真实按键/点击）：预设 chip 4 项、点击后 size 3840 / bar「社媒 · 4K · JPEG」、速查浮层 8 行（含 Ctrl+Shift+E）、批量对话框可见 + 预览 + 取消关闭 ✓（全部通过）。
- **E2E 新增 11 项断言**（Step 6 九项 + 排版几何两项）→ 期望 287；run5 = **281/287**：原有 276 项全过，6 项新检查失败 → 两类根因：① 快捷键检查焦点残留在 `#exportMulti`（输入守卫吞键）→ 按键前 blur + 输入守卫改为前后状态对比；② 排版几何检查取不到 `info-block` 盒 → **`web/` 侧模板镜像与 wasm 引擎陈旧**（迁移只改 `templates/`，`web/templates/` 与 `web/pkg` 未更新；SW 亦缓存旧模板）→ 已 `node tools/gen-templates.mjs`（192 套镜像）与 `node tools/wasm-build.mjs`（EXIT=0，smoke: frames byte-identical）。
- **几何验证**（`target/probe-typometry.mjs`）：清 caches/SW + 注入照片 → 模板 version 1.4.0、引擎接受 `infoBlock`（err null）、`info-block` 盒 x=0,y=1217,w=500.9,h=68（children 2），frame 1600×1302、padding.bottom 0.085 → 留白带 102px，盒高 68px = 2/3 带高 ✓。
- **待办**：全量 E2E 重跑（run6，预期 287/287）→ perf 4/4 → 桌面端重建 + 探针 9/9 → 全量门禁 → 版本号四处 1.0.0 + 文档 → 发布（六资产 + Pages + 桌面端）。

### 5.4 E2E 迁移适配与 run7 根因（2026-09-28）

- **run6 = 269/287** 的 18 项失败全部属迁移适配（模板不再含文字层）→ 审计侧修补：`__fgEnsureTextLayer()` 在 `exif editor` / `editor layer rows` / canvas 选择 / zh 属性标签等处「ensure + 点击」；`v0.7/v0.9 typography` 探针与断言改为 v1.0.0 语义（模板 1.4.0 / 引擎 1.0.0 / 字体家族含 infoBlock / EXIF 行在 info block / display+support 角色）。
- **run7 = 273/287** 的 14 项失败 → 四个根因（`target/probe-run7sites.mjs` 实测）：① canvas `sel` 探针丢了 `selId` 定义（`b0` undefined → `b0.x` 抛错 → 载荷 `{}`）→ 恢复 `selRow/selId/click`；② 排版几何等待调用了不存在的 `window.__fg.boxFrame` → TypeError → 载荷 `{band:0,ibH:0}` → 改用 `window.__fgEditor?.boxFrame?.()`；③ `batch: button visible` 读数在元素未就绪时返回 undefined（探针证明按钮本身可见）→ 改为轮询 + 诊断 payload；④ `exif editor rows` / `editor layer rows` 只 ensure 不点击 → 补 `.click()`（迁移后 `classic-watermark-single-row` 仅 1 层 brandmark + infoBlock，ensure 后为 2 层，满足 ≥2 断言）。
- **环境**：run7 启动脚本曾自我终止（WMI 过滤匹配到自身命令行里的 `--remote-debugging-port=9237`）→ 过滤改为 `Name='msedge.exe'`；审计日志改用 `Out-File -Encoding utf8`（PS5 的 `*>` 写 UTF-16LE）。
- **待办**：run8 全量 E2E（预期 287/287）→ perf 4/4 → 桌面端重建 + 探针 9/9 → 全量门禁 → 版本号四处 1.0.0 + 文档 → 发布（六资产 + Pages + 桌面端）。

### 5.5 发布记录（v1.0.0，2026-09-28）

- **本地提交** `8708de63dfca379942260ef9731187897f911083`（父 `4060b5d`，1237 项：192 套迁移模板 + 576 张样片 + web 资产镜像 + 基线 + 文档）→ **远端 `main` `62a5c69d544e3e8f4928d9f283a86e809324baa7`**（Git Data API 推送；templates 576/576、web 582/582）。
- **注解标签** `v1.0.0` → tag object `c955c821f1fe995c14c33dfd422fd78788caeac4`（`gh api git/tags` + `git/refs`；首次尝试因 `Out-File` 写入 UTF-8 BOM 被拒 → 改 `[System.IO.File]::WriteAllText` 无 BOM）。
- **工作流（2026-09-28）**：main push → ci `36388379833` / pages `36388379861`；tag v1.0.0 → ci `36388415172` / **release `36388415276`**；收尾文档推送 → ci `36391168448` / pages `36391168353`、ci `36391780046` / pages `36391779987` —— **全部 completed/success ✓**。
- **Release**：https://github.com/meihuaanying/framegeist/releases/tag/v1.0.0 ；六资产 `framegeist-cli-v1.0.0-win-x64.zip` 77,603,403 B / `framegeist-desktop-v1.0.0-win-x64.zip` 101,379,959 B / `FrameGeist-v1.0.0-win-x64-setup.exe` 101,360,697 B / `framegeist-templates-v1.0.0.fgpkg` 20,674,803 B（count 192）/ `SHA256SUMS.txt` / `update.json`；**哈希一致 ✓**（SHA256SUMS 四项 = update.json 四项：cli `ffdf7bef…`、desktop `1f09678a…`、setup `2e3d90ed…`、templates `244ae14b…`）；说明注入 `gh release edit v1.0.0 --notes-file docs/releases/v1.0.0.md`（body 3549 字符）。
- **Pages 验证** ✓：线上 `app.js` `APP_VERSION = "1.0.0"`、`sw.js` 缓存名 `framegeist-1.0.0`。
- **门禁**：E2E **287/287**（真实 CDP 输入 + 11 项 v1.0.0 新断言；run5 281 → run6 269 → run7 273 → run8 283 → run9 287）；perf **4/4**（24MP 506/965ms、60MP 626/2374ms）；桌面端重建 + 探针 **9/9**；fmt/clippy/test/四 target/wasm 帧字节一致；JS 七项（i18n 524/524、品牌色 169/169、对比度、字形 192/279/0、UTF-8 933/0、模板 192/192）；样片 576、基线 384、对比图 25 类 150 组。
- **文档**：README 亮点页改 v1.0.0；AGENTS.md v1.0.0 横幅（含哈希）与「下一步 = v1.1 backlog」；release notes（`docs/releases/v1.0.0.md`）。
- **收尾文档推送**：本地 `426e0e1`（AGENTS v1.0.0 横幅 + 本节）→ 远端 `main` `4e130cd737095d8b22ef63288840db8647098b51`（Git Data API；推送工具首次 PATCH 报 422「not a fast forward」，但远端 ref 已指向新提交，对照远端 commit/patch 确认内容一致）；main push 触发 ci `36391168448` / pages `36391168353` —— 两者均 completed/success ✓。
- **v1.1 跟进**：官方素材 `brand-official-inbox/` 落地（57 项审计；`brand-audit-lens.md` 的 11 问待裁决）；info-block 行编辑 UI；调研提案 P4–P8。
