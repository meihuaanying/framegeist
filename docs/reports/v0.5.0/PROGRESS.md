# FrameGeist v0.5.0 Progress

> Contract: `docs/V0.5.0-CONSTRAINTS.md`. One section per milestone, written as soon as the milestone gate is green.

## M0 — 底座验证 ✅ (pre-existing)

- cosmic-text 0.19 wasm32 spike passed (recorded in contract §6 M0).

## M1 — 照片唯一化管线 ✅ (2026-09-14)

**Delivered**

- `tools/fetch-showcase-photos.mjs`: assigns one globally unique showcase photo to every template.
  - 11 existing photos stay in use (one template each); 173 downloaded from Lorem Picsum.
  - Orientation rules: `phone/personal/polaroid/ticket/calendar` get portrait photos; others landscape.
  - Tone bias: `blur-bg/effect/film/black-frame` dark, `white-border/portfolio/minimal` bright, `colorful/colorcard/festival` saturated; author cap 3; seeded deterministic picks.
  - Outputs: `templates/assets/photos/showcase/<id>.jpg`, `showcase-map.json`, `CREDITS-DEMO.json` (184 entries with sha256 + luminance/saturation).
- `tools/gen-samples.mjs` (new): renders samples(900)/previews(640)/thumbs(240) per template from its own photograph, mirrors thumbs+previews to `web/`; `tools/gen-samples.ps1` reduced to a wrapper for CI compatibility.
- `tools/check-photo-uniqueness.mjs` (new gate): PASS on all checks.

**Gate evidence (2026-09-14)**

```
PASS  showcase: 184 templates — 184 templates
PASS  showcase: every template mapped
PASS  showcase: 184/184 files exist — missing 0
PASS  showcase: byte-unique photos
PASS  showcase: portrait categories get portrait photos
PASS  showcase: dark categories are darker than bright — dark 0.223 vs bright 0.718
PASS  showcase: zero test photos — test hashes 4
PASS  showcase: sample mirrors complete and unique — samples/previews/thumbs
```

552 renders (184×3) regenerated with zero failures; showcase tree contains no test photo bytes.

## M2 — 引擎：cosmic-text + 字效矩阵 + 新图层 + Fuji EXIF + 导出选项 ✅ (2026-09-14)

**文本引擎**

- `cosmic-text 0.19` + swash 接手默认排版（HarfRust shaping：kerning/连字/字重、`Attrs::letter_spacing`）；`crates/framegeist-core/src/text_shape.rs` 输出字形 alpha 掩膜。
- 旧 `ab_glyph` 路径保留为 `--legacy-text-renderer`（`RenderOptions.legacy_text_renderer`），用于回归对照。
- `FontBook` 保留原始字节 + 懒加载 fontdb（跨克隆共享），真实 family 名映射。

**字效矩阵（全部掩膜后处理，CLI/WASM 逐字节一致）**

- 描边：外描边 / 白边 / 双线 + 粗细/间隔/颜色（距离场膨胀，抗锯齿）。
- 立体：emboss / engrave / letterpress / inner-shadow（偏移高光+阴影、深度、透明度）。
- 材质：gradient / foil（镜面高光带）/ texture（模板包纸纹）× 掩膜。
- 文字：case upper/lower/title、flipX/flipY、scaleX（水平拉伸）。
- 阴影：文本外阴影（偏移/模糊/色/透明度）。
- 尺寸：`width` 定宽换行、`height` 自适应字号、`stretchWidth`/`stretchHeight`/`fillPage`。
- 布局：shape `frame` outer / opposite-h / opposite-v（+double/gap/margin）；`autoHide` 自动分割线（少于两个文本层隐藏）；`span:"auto"` 定量横线。
- 新图层：`group`（子层相对组框布局 + 组不透明度）、`calendar`（月历网格 + 农历日标签，1900–2100 查表，无数据不显示）。
- 绘制顺序：`z` + 声明序稳定排序；贴附徽章仍最后绘制。

**EXIF / 导出**

- Fujifilm MakerNote 尽力解析：film_mode / wb_mode / wb_shift / grain / color_chrome / chrome_fx_blue / dynamic_range / highlight_tone / shadow_tone / sharpness / saturation（未知值隐藏，不造假）。
- `TemplateOverrides.metadata`（默认 true）+ `crop{x,y,w,h}`；CLI `--legacy-text-renderer`。

**门禁证据**

- `cargo test --workspace` 全绿；新增 `engine_v050.rs` 13 项（描边/双线/渐变/阴影/大小写/自适应/组/分割线/日历/裁切/元数据开关/双引擎/Fuji MakerNote 像素与结构断言）；`calendar.rs` 新增 5 项农历/星期单测。
- `cargo clippy --workspace --all-targets -- -D warnings` 零告警。
- WASM↔CLI：3 个 fixture 帧渲染**字节一致**，拼图像素差 0.000013（≤0.001）。
- 黄金基线已按渲染器语义变更全量重生成（原因记录于本文件）。
- 8 款艺术风格模板（art-*.json）由子 Agent 原创设计、逐张实拍渲染并经 Read 目视核验；`validate-templates.mjs` 8/8 通过。
- 模板总数 184 → **192**；showcase 照片扩展至 192 张（全局唯一）；sample/preview/thumb 576 张重渲；unique 门禁全绿。

## M3/M4 — 编辑器 UI（图层/直操/吸附/撤销/字效预设/日历/相框/裁切）✅ (2026-09-15)

**新增 `web/editor.js`（v0.5 编辑器模块）+ index.html/styles.css/i18n.js 扩展**

- 编辑模型：每模板 JSON 级编辑（localStorage `fg-tpl-edits-v1`）+ 撤销/重做命令栈（≥60 步，输入合并）；`useTemplate`/`selectTemplate` 均刷新面板。
- 图层面板：列表/选中（多选 shift）/显示隐藏/锁定/上移下移置顶置底/复制/删除/编组（group 层）。
- 画布直操：点选命中（引擎 `layer_boxes`）、拖拽移动 + **吸附辅助线**（画布与其它图层边/中线）、角handle 缩放（文本字号/形状尺寸/日历尺寸）、旋转 handle（4° 吸附 90° 倍数）、方向键 1px/10px 微调、Delete 删除、Esc 取消。
- 元素属性（滑杆+数值双模）：offset/rotation/opacity/z、文本（字号/字距/行高/对齐/颜色/case/描边/双线/填充渐变烫金纹理/立体/外阴影）、形状（颜色/尺寸/双线/autoHide/布局框）、日历（视图/农历/周表头/颜色/强调色）。
- 8 款艺术风格「文字样式预设」一键应用到选中文本层。
- 添加元素：文字/日历/分割线/线框/色卡。
- 相框：上传 PNG → `@user/frame` + `canvas.frame`（autoDetect/scale/inset），空白窗口检测由引擎执行。
- 裁切：overlay 裁切框（拖动/角缩放/比例锁定）→ `overrides.crop`。
- 两档面板：`fg-panel-tier` 简洁/高级（高级含添加/属性/相框/裁切）。
- 导出：720P（1280）预设 + 设置页「保留拍摄元数据」开关（`metadata=false` 时剥离 EXIF，GPS 仍默认剥离）。

**引擎补齐（UI 支撑）**

- `boxes.rs`：`layer_boxes`（wasm 导出）返回每个图层的画布像素包围盒（text/shape/image/palette/group/calendar，含组子层）。
- `canvas.frame`：帧 PNG 覆盖 + 透明窗口最大内接矩形检测（直方图法）+ 照片按窗口 cover 适配。
- 布局/尺寸修复验证：拖拽吸附到画布中心误差 < 5px；导出尺寸/元数据开关经 E2E 断言。

**门禁证据（2026-09-15，headless Edge + CDP，网络路径无 SW 缓存）**

```
=== E2E audit: 79/79 passed ===
```

新增断言（v0.5）：两档面板、图层行选择、方向键微调、撤销/重做、拖拽吸附居中、样式预设（foil + 像素变化）、日历插入、裁切 overlay、相框上传、720P 预设、元数据开关持久化与 engine override、`layer_boxes`、描边像素、日历渲染、crop override 尺寸、图层复制/删除 —— 共 79 条（门禁 ≥70）。

## M5 — 日历 + 相框制作 + 自由拼图 ✅ (2026-09-15)

**日历**（M2 引擎 + M3 UI：插入/月历网格/农历/周表头/强调色）与**相框制作**（上传 PNG + 引擎空白窗口检测 + cover 适配）已在 M3/M4 交付并过 E2E。

**自由拼图（本轮收尾）**

- 修复 UI overlay 与引擎的高度口径：`freeItemBox` 现在对未显式指定 `h` 的 item 使用照片真实朝向宽高比（`photo.ar`，上传时经 `createImageBitmap` 记录），缩放拖拽基准同步修正 —— overlay 方框与引擎输出逐项对齐（landscape/portrait/square 三图 overlay 高宽比实测 0.77/1.28/1.00）。
- `acceptFiles`：新照片集合进入自由拼图时重建默认布局（与「先选照片再开自由拼图」的用户流程一致）。
- E2E 新增 5 条断言：拼图模式照片接入、自由拼图 3 item/4:3 画布（1600×1200）渲染、overlay 方框随照片宽高比、拖拽位移（64/32 画布像素 → dx=0.04/dy=0.0267）、增删 item 同步 spec + 图层列表。

**门禁证据（2026-09-15，headless Edge + CDP）**

```
=== E2E audit: 84/84 passed ===
```

截图 `docs/reports/v0.5.0/07-free-collage.png`。

## M6 — 模板接入新能力 + 视觉审计 + PARITY 缺口关闭 ✅ (2026-09-16)

**模板与审计**

- 26 张分类接触表（`docs/reports/v0.5.0/audit/*.jpg`，覆盖全部 192 samples）逐张人工 Read 目视：无渲染破损；`game-zzz-v2` 白色角标系极小字号 + autoTint 选白，属设计非 bug。
- 15 套模板轻量升级（全部 `validate-templates.mjs` + 实拍渲染目视通过）：
  - 日历 5 套换真实 `calendar` 层（center-rule/strip-date/rail-date/split-columns/portrait-stack，version 1.1.0，minEngineVersion 0.5.0），日历几何与重叠修复验毕；`calendar-corner-day-01` 保留文字版（overlay 上对比度不可控）。
  - 分割线 6 套加 `autoHide:true`（classic-watermark-hairline-thin / black-frame-gold-line-01 / camera-topdeck-bar-01 / drone-topline-01 / portfolio-atelier-plate-01 / white-border-ruled-band）。
  - 标题字效 4 套（sports-big-trail-01 letterpress、drone-altitude-hero-01 emboss、master-crown-wordmark-01 foil+emboss、magazine-cover-banner-01 shadow）。
- `tools/gen-samples.mjs --only` 修复：CLI 拒绝覆盖既有文件，渲染前先删除旧产物；15 套 samples/previews/thumbs 重渲（45/45 成功）+ web/ 镜像（192/192 × 2）。
- 重生成 `web/templates.json` manifest；重做 10 张受影响分类接触表（Cols=5、340×280、Title=分类名）。
- E2E 第 40 节「相邻同类模板缩略图差异 >3%」（DESIGN-LANGUAGE 规则 6，页面内 canvas 归一化 160×160 + 通道阈值 8）：167 对全过，min 38.90%（portfolio-marginalia-01 ↔ portfolio-noir-matte-01）。

**PARITY 缺口关闭（关键发现 → 全部闭环）**

- 建立 `docs/reports/v0.5.0/PARITY.md`（此前缺失）逐项核对契约 §3.1，发现此前 M4/M5 "功能对齐"高估：14 模块仅 2 ✅ / 10 🟡 / 2 🔴。按契约 §4「宁可延长工期，不缩水」关闭全部缺口：
  - 引擎：`background:"tint"`、`margin` 0–0.5、`textureAsset` + `BgKind::Texture`、`card{enabled,radius,shadow,border,innerShadow}`、`canvas.frame.rotation`、`CalendarLayer.binding` + `view:"week"`、Fuji `noise_reduction`/`clarity` 解析（LUT1/2 无 MakerNote 标签 → 隐藏不造假，已注明）。
  - Web：最近使用 ring buffer + chip；图层重命名/取消编组/对齐（6 向）/分布；双击裁切 + 填满宽/高；设置 720P；背景 tint/预设色板（复古中性）/eyedropper/纹理；margin 滑杆；卡片特效面板（含内阴影 + 低配提示）；相框内置库网格/offset/rotation；自由拼图交换/圆角/描边/单图裁切/间隔+边距+重排；水印调整面板；插入图片元素；EXIF Fuji 配方分组；日历布局预设 + 强调色。
- 最终 `docs/reports/v0.5.0/PARITY.md` **14/14 模块 ✅**（水印粒度、拼图重排语义、Fuji LUT 缺失原因如实注明）。

**门禁证据（2026-09-16，headless Edge + CDP，最终 revision）**

```
=== E2E audit: 158/158 passed ===
```

- E2E 85 → 158 条：§40 相邻差异、§47-53 背景/边距/卡片/相框、§54-61 拼图/水印/插入图片/EXIF/日历、§62 卡片内阴影；新增「runtime: no page exceptions/console errors」硬门禁。
- `cargo test --release --workspace` 全绿；clippy exit 0；wasm 重建 + smoke（帧字节一致 / 拼图 0.000013）；四 target 构建全过。

## M7 — 全量门禁 ✅ (2026-09-15首测 / 2026-09-16终测)

| 门禁 | 结果 |
|---|---|
| `cargo test --release --workspace` | 全绿（core/exif/fuzz/template_validation/engine_v040/engine_v050/CLI 各套；终测含新增 tint/margin/card/rotation/week/binding/texture 用例） |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| WASM 重建 + `wasm-smoke` | `frames byte-identical, collage within PRD N2 pixel gate`（拼图差 0.000013） |
| 四 target（core --release） | msvc ✅ / wasm32 ✅ / aarch64-linux-android ✅（无需 NDK，rlib 不链接）/ aarch64-unknown-linux-ohos ✅ |
| 性能（契约 §4，headless Edge + WASM，`tools/perf-audit.mjs`） | 终测：24MP 预览 **168ms**（≤600）；24MP 导出 **1032ms**（≤2000）；60MP 预览 **638ms**（≤1500）；60MP 导出 **2696ms**（≤4000），4/4 PASS |
| E2E | 终测 158/158（门禁 ≥70） |

新增 `tools/perf-audit.mjs`：CDP 驱动真实 Web/WASM 引擎，预热 + 2 次平均，按 §4 四项门禁断言；预览走应用真实快路径（浏览器解码 → 1600px RGBA → `render_raw`），导出走 `render_with_overrides` full。



