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
