# FrameGeist v0.9.0 Progress

> Contract: `docs/V0.9.0-CONSTRAINTS.md`（三轮 grill，24 项决策）。One section per milestone, written as soon as the milestone gate is green.

## M0 — 资产与引擎颜色系统 ✅ (2026-09-21)

- **官方色采集** `tools/fetch-brand-colors.mjs`（新增）：经 `api.github.com` Contents API（`simple-icons.json@develop`）抓取官方 hex，按阈值规则（HSL `s ≥ 0.18` 且 `0.10 ≤ l ≤ 0.90`）判定彩色 → 锁定 `tools/brand-colors.json`：**19 个官方图标（15 彩色 / 4 单色）**；Simple Icons 已下架品牌（canon、hasselblad、ricoh、sigma、zeiss、tamron、olympus、pentax、gopro、sandisk…）保持原创排版 mono，不臆造官方色。
  - 彩色：nikon / fujifilm / leica / panasonic / epson / insta360 / samsung / vivo / oppo / oneplus / huawei / google / motorola / nokia / blackmagicdesign；单色（官方黑/白）：sony(#FFFFFF) / dji / apple / honor。
- **资产管线** `tools/gen-brand-assets.mjs` 重写：主变体（彩色=官方 hex，单色=黑）+ **`-mono`（新增）** + `-light` + 三套 96px thumbs；`brand|lockup` 同品牌同色，`series|game` 两变体；图标抓取走 API 路径（`raw.githubusercontent` 本机不可达）。
- **清单** `web/brand/index.json` → **v3**：`{slug, label, official, color}`（兼容读取 v2）。
- **像素级门禁** `tools/check-brand-colors.mjs`（新增，内置极简 PNG 解码器）：变体矩阵齐全、彩色主变体高饱和像素、mono 无饱和、manifest `color` 一致 → **128/128**。
- **引擎**（`render.rs`/`template.rs`）：新 `ink_stats()`；`tint:"auto"` 下官方彩色在局部对比 ≥3.0（WCAG 1.4.11）保留，否则回退 `-mono`/`-light`，仍不足沿描边/底板；新增 `tint|contrast:"color"` 强制彩色；**图层字段优先**（`contrast` > 模板级 override；`corner` 支持 `"anchor"` 哨兵；显式非 1.0 `opacity` 优先）；尺寸 6.5% / 6% / 44%。
- **测试** `engine_v070.rs` 9/9（含 4 条新颜色用例：保留彩色 / 低对比回退 / 强制彩色 / 暗底回退）；CLI `engine_v020.rs` 旧 autoTint 断言升级为 v0.9 语义（保留低位彩色回退 + 新增 ≥3:1 保留彩色）。
- **Web**：`libThumb`/`markSlugVariant` 彩色缩略图（暗色主题彩色品牌仍彩色；mono 品牌用 `-light`）。

## M1 — 尺寸提升 + 模板重跑 ✅ (2026-09-21)

- **引擎**下限 `0.05→0.06`（仍 ≥18px）、默认层高 `0.045→0.065`、最大宽 `0.38→0.44`。
- **脚本** `tools/apply-v090-typography.mjs`（幂等标记 `meta.version = 1.3.0`）：徽标层 `height ×1.3`（上限 0.12，结果 <0.06 抬到 0.06，原 ≥0.10 保持），沿用越界/重叠守卫（1.3→1.15→1.0）。
  - 结果：**192/192 模板 → version 1.3.0**；191 个徽标层中 **190 个 ≥6%**（183 个 0.06、6 个缺失补 0.065、1 个 0.078）；**1 个守卫例外**：`borderless-lowleft-pair-01` 保持 0.045（0.06 时与 lens 文本重叠 >25%，回退被 6% 下限钳制）——已记入 `typography-report.json` 的 `summary.exceptions`。
- `validate-templates --all` **192 ok / 0 failed**；`check-glyph-coverage` **355 对 0 缺失**；`gen-templates.mjs` 重建 web 镜像与 marks。
- 样片三档重渲 **192/192（576 张）**；视觉基线 **有意重生成 384 项**（原因：彩色徽标 + 尺寸提升 + 3.0 对比阈值），复核 384/384 全绿；对比图 **25 分类 × 3 套 = 150 组**（标签 v0.8.0 → v0.9.0）。

## M2 — 侧边栏 Tab 重构 + i18n ✅ (2026-09-21)

- **结构**：`.sidebar` 改 grid = 固定五 Tab 头（模板 / 照片 / 元素 / 画布 / 导出）+ 单一滚动面板 + 底部紧凑导出条（实测 **48px**）；Tab 选择持久化 `fg-sidebar-tab`。
- **移除**：`.actionbar`（261px sticky 遮挡根源）、tier（`#tierToggle`/`#panelTierBtn`/`advanced-only`）、独立 `#brandCard`、墙顶 `#wallBrandLib` 与 `#brandLibModal`（含死代码）。
- **i18n**：新增约 105 键（`side.*`/`stage.*`/`layer.role.*`/`props.*`/`opt.*`）→ **485/485 对齐 0 失败**；属性标签全部改 i18n key（`offset.x→水平偏移` 等）；新增 `layerDisplayName()` 中文图层名（徽标 · Canon / 机型 / 参数 / 日期…）。
- `tools/check-i18n.mjs` 升级：`addDual/addSelect/addCheck/addColor(grid, "<label>")` 首参必须是已存在 key；E2E 扫描扩至全部侧栏面板。
- E2E §25 改 Tab 断言；§81 新增布局/导出条/i18n 断言。

## M3 — 画布直接操作 ✅ (2026-09-21)

- **手柄**：四角 `h-nw/ne/sw/se` + 旋转 `rot`（仅文本/形状）；视觉 10px 圆点、命中 **24×24**（`pointer:coarse` 14/32）；`touch-action:none` + pointer capture + 方位光标；旋转柄顶边上方 26px。
- **缩放**：以指针到盒中心距离比例写 `startSize × factor`（修复指数放大 bug）；语义：文本→字号、日历/形状/图片/色卡→等比尺寸、线段→长度+粗细。
- **旋转**：写 `text/shape.rotation`（修复 0 值缺键失效）；15°/90° 吸附。
- **点选**：命中自上而下；已选集内再点 = 拖该层；单击（位移 <4px）重叠循环穿透（pointerup 判定）；Shift 多选；空白清空。
- **浮动工具条** `.sel-toolbar`：删除 / 复制 / 置顶 / 置底 / 锁定；`--inv-zoom` 反缩放。
- **舞台**：`#zoomSelect`（fit/50/75/100/150/200）+ 适应/重置按钮 + `#stageSize`；空白左键不再平移（空格/中键平移）；选中自动 `panIntoView()`（含拖拽结束 250ms 后）；`img.onload` 仅在 `autoFit` 时 fit。
- E2E §80 覆盖全部新交互 + 手柄命中/自动移入视野。

## M4 — 徽标库集成与筛选修复 ✅ (2026-09-21)

- `#insertCard` 3 列插入网格（文字/图片/徽标/日历/分割线/线框/色卡）+ 内嵌 `#badgeLibPanel`（分组 chips / 组内搜索 / 收藏/最近快捷行 / 自动识别 / 上传 / 风格）；移除独立卡片与墙入口/弹层。
- **筛选修复**：`renderBrandLibrary()` 先按 `brandLibState.group` 过滤再传 `renderLibGrid`；chip 单选并显示计数；搜索在当前分组内。
- **插入流程**：无徽标层时点「徽标」新增 image 层（默认主变体 + 右下角 + 6.5%）并选中；有则选中并展开库。
- **属性面板**：选中徽标层显示「显示徽标 / 本图层单独覆盖 / 位置 / 大小 / 对比保护（含官方彩色）/ 不透明度」；勾选写图层字段（`corner/margin/size.height/contrast/tint/opacity` + UI 备份还原），未勾选写模板级 override；优先级 **图层字段 > 模板级 > 模板 JSON**。
- E2E §79/§75b/§81：manifest v3 彩色、五 chips 计数过滤、组内搜索、插入/替换、自动恢复、覆盖优先级、墙入口不存在、卡片标记彩色、暗色主题缩略图。

## M5 — 全量门禁 ✅ (2026-09-22)

- **工程**：`cargo fmt --all -- --check` ✓；`cargo test --release --workspace` 全绿（exit 0，21 个 test target；engine_v070 9/9；修复的 CLI autoTint 用例通过）；`cargo clippy --workspace --all-targets -- -D warnings` ✓；四 target（win-x64 / wasm32 / aarch64-linux-android / aarch64-unknown-linux-ohos）✓。
- **WASM**：`node tools/wasm-build.mjs` → 模块 **5,059,244 B**（v0.8: 5,058,426 B）；WASM↔CLI 帧字节一致；拼图差异 0.000013 ≤ 0.001。
- **门禁**：`check-i18n` 485/485；`check-brand-colors` 128/128；`check-ui-contrast` APCA 全过；`check-glyph-coverage` 355 对 0 缺失；`check-utf8` 913 文件 0 损坏；`validate-templates --all` 192 ok / 0 failed。
- **视觉**：样片重渲 192/192（576 张）→ 基线 `--update` 重生成 384 项（记录原因：彩色徽标 + 尺寸 + 对比阈值）→ 复核 384/384（hamming ≤10、meanΔ ≤2.5）；对比图 25 分类 / 150 组（`--before-label v0.8.0 --after-label v0.9.0`）。
- **E2E**：`FG_CDP_PORT=9237 node tools/e2e-audit.mjs docs/reports/v0.9.0` → **271/271**（首轮 270/271：§81 单击穿透为固定 sleep 竞态——第一次点击后自动平移改变坐标映射 + 重渲未完成时 `S.boxes` 陈旧）。
  - 修复：`editor.js` debug 增 `boxes`/`stageReady` 只读字段；§81 改为轮询 overlay 与舞台一致后再点击，第二次点击按同一 canvas 坐标重算 client 点。
- **性能**（CDP 真浏览器，`tools/perf-audit.mjs`）：24MP 预览 **171ms** / 导出 **914ms**；60MP 预览 **295ms** / 导出 **2256ms** —— **4/4** 达标（v0.8: 166/892/285/2277ms，无劣化）。
- **人工审查**：`compare/camera.png`、`compare/colorwalk.png` 抽检（徽标变大、Nikon 黄色 / Canon 原创 mono 正常）；`brand/thumbs/nikon.png`（黄）、`sony.png`（黑）、`fujifilm.png`（红）抽样通过；5 Tab 截图归档 `docs/reports/v0.9.0/`。
