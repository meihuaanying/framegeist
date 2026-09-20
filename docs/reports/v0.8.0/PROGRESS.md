# FrameGeist v0.8.0 Progress

> Contract: `docs/V0.8.0-CONSTRAINTS.md`（18 项 grill 决策）。One section per milestone, written as soon as the milestone gate is green.

## M0 — UI 全量中文化 + i18n 门禁 ✅ (2026-09-20)

- **i18n 扩展**：`web/i18n.js` 新增徽标库（`brandLib.*` 16 键）、图层类型（`layer.type.*`）、启动/首启提示、收藏/最近、空态等约 40 键；zh/en 各 **380 键**完全对齐。
- **硬编码清理**：`web/app.js`、`web/editor.js`、`web/index.html` 的 `textContent`/`title`/`aria-label`/`placeholder`/`toast()` 全量走 `t()`；`applyI18n` 新增 `data-i18n-aria-label` 支持；图层显示/隐藏/锁定 title 本地化；7 个预设选项、主题按钮 aria 本地化。
- **新门禁** `tools/check-i18n.mjs`：键集合对齐 + 占位符一致 + 未翻译/未知键 + JS/HTML 硬编码文案扫描（白名单见契约附录 B）；退出码 0/1，可挂 CI。当前 **0 failure**。
- **Q15 崩溃修复并入**：字体请求超时保护、按文件追踪字重（`loadedFiles`）、灯箱 `.brand-strip.lightbox` 类名冲突改为 `lb-brand`。
- E2E 新增中文界面可见文本英文残留扫描（后并入 section 79）。

## M1 — 徽标库 ✅ (2026-09-20)

- **资产管线** `tools/gen-brand-assets.mjs` 重写：512px + **96px `thumbs/`** 双档（brand/lockup/series/game）；新增中性「EXIF」原创标 `brand/exif-auto[-light]`；补齐 `series/leica-apo`、`brand|lockup/voigtlander`。
- **清单** `web/brand/index.json` 升级 **v2 分组结构**：`{version:2, groups:{camera:28,lens:38,series:13,game:6}, neutral:"exif-auto"}`（保留旧数组兼容读取）。
- **编辑器卡片**：右侧栏「徽标库」（替换原品牌卡）＝ 作用图层指示 + 搜索 + 分组 tabs + 收藏/最近 chips + 96px 网格 + 「自动识别（EXIF）」+「上传自定义」/清除；保留风格/位置/大小/对比/透明度控件。
- **图层级替换**：`editor.js` `badgeTarget()`（选中层优先，否则第一个徽标层并提示）、`setBadgeAsset()`（`"auto"` 从原始模板恢复表达式）、`swapBadgeStyle()`（实体层 brand↔lockup 互换）；编辑写入 `fg-tpl-edits-v1` 的 `asset` 字段。
- **收藏/最近**：`fg-brand-fav-v1` / `fg-brand-recent-v1`（最近最多 12）。
- **模板墙**：顶栏「徽标库」入口弹层（只读浏览 + 风格 + 分组 + 搜索 + 进入编辑器替换）；卡片品牌标记（≤3 枚 96px，表达式层显示 `exif-auto`）；**175/192 套有标记**。
- **性能**：`.wall-card`、`.thumb`、`.brand-lib-cell` 加 `content-visibility:auto` + `contain-intrinsic-size`。
- E2E section 79：徽标库 15 条断言（分组/96px/点击替换/EXIF 恢复/收藏/搜索/风格互换/墙弹层/卡片标记/骨架/content-visibility/中文标签）。

## M2 — 默认尺寸提升（引擎 + 模板 + 测试）✅ (2026-09-20)

- **引擎** `render.rs`：徽标下限 `0.035→0.05`（仍 ≥18px）、默认层高 `0.03→0.045`、最大宽 `0.32→0.38`；`engine_v070.rs` 5/5 绿（含新增「4.5% 默认高」「38% 最大宽」断言）。
- **新 CLI 子命令** `framegeist boxes <photo> --template <file>`：输出 `{canvas:{w,h}, boxes:[...]}`；新增 `framegeist_core::boxes::canvas_size_for_photo`。
- **脚本** `tools/apply-v080-typography.mjs`：角色放大 Data/Label ×1.2、Support ×1.1、Display 不变（下限 0.0095）；徽标层抬到 ≥0.045；基线对比 + 跳过旋转层的越界/重叠守卫（冲突按 1.1→1.0→原值回退）。
  - 结果：**192 套处理、178 个徽标层抬高、6 套 12 层回退、0 未解决**；报告 `docs/reports/v0.8.0/typography-report.json`；`meta.version` → **1.2.0**（幂等标记），`minEngineVersion` 保持 0.7.0。
- **字体补齐**：`tools/fetch-fonts.mjs` 补 Instrument Serif（OFL 静态 400）→ **69 faces / 23 families**；`fonts.json` 与 web 镜像重建。
- 校验：`check-glyph-coverage` 355 对 0 缺失；`validate-templates --all` **192/192**。

## M3 — 性能与首启体验 ✅ (2026-09-20)

- 墙卡/选择器缩略图/库格子 `content-visibility:auto` + `contain-intrinsic-size`（挂在重复叶子上）。
- 库/墙图片 `loading="lazy" decoding="async"`；库网格 IntersectionObserver 渐显。
- 启动墙骨架 `showWallSkeleton()`（`window.__wallSkeleton = {shown, at, clearedAt}`，`buildWall()` 清除）；8s 状态提示 / 25s toast（`status.bootSlow`/`err.bootHint`）。
- 不引入新运行时依赖。

## M4 — 全量门禁 ✅ (2026-09-20)

- **工程**：`cargo fmt --all -- --check` ✓；`cargo test --release --workspace` 全绿（金标未受影响）；`cargo clippy --workspace --all-targets -- -D warnings` ✓；四 target（`x86_64-pc-windows-msvc` / `wasm32-unknown-unknown` / `aarch64-linux-android` / `aarch64-unknown-linux-ohos`）构建 ✓。
- **WASM**：`node tools/wasm-build.mjs`（SIMD + wasm-opt -O2 + smoke）→ 模块 **5,058,426 B**；WASM↔CLI 帧字节一致；拼图差异 0.000013 ≤ 0.001。
- **门禁**：`check-i18n` 380/380 0 failure；`check-ui-contrast` APCA 全过；`check-utf8` 904 文件 0 损坏；`check-glyph-coverage` 355 对 0 缺失；`validate-templates --all` 192 ok / 0 failed。
- **样片重渲**：`node tools/gen-samples.mjs --concurrency 6` → `rendered=192 failed=0`；`templates/{samples,previews,thumbs}` 与 `web/{previews,thumbs}` 均 **192 张**。
- **视觉基线（有意重生成，记录原因）**：字号（Data/Label ×1.2、Support ×1.1）与徽标默认尺寸变化导致全量像素差异 → `node tools/visual-regression.mjs --update` 重生成 **384 项**，复核 384/384 在容差内（hamming ≤10、meanΔ ≤2.5）。CLI 金标未变化（其用例显式声明尺寸），无需重生成。
- **对比图**：v0.7.0（线上 Pages 样片快照 `.cache/v070-samples`，192 张）→ v0.8.0，`docs/reports/v0.8.0/compare/` **25 分类 × 3 套 = 150 组**。
- **E2E**：`FG_CDP_PORT=9237 node tools/e2e-audit.mjs docs/reports/v0.8.0` → **235/235**（v0.7 218 + section 79 的 15 条 + 门禁适配）。
  - 适配修复：图层行新增 `data-type` 稳定属性，旧探针由 `.ltag` 英文标签改为数据集选择器（本地化后中英通用）；模板版本断言 1.1.0 → 1.2.0；「品牌 Logo」卡面文案改为「徽标库」以清除 `text-transform:uppercase` 导致的 `LOGO` 残留。
- **性能**（CDP 真浏览器，`tools/perf-audit.mjs`）：24MP 预览 **166ms** / 导出 **892ms**；60MP 预览 **285ms** / 导出 **2277ms** —— **4/4** 达标（阈值 600/2000/1500/4000ms）。
- **桌面端**：`cargo build --release -p framegeist-desktop`（0.8.0，3m49s）✓。

## M5 — 文档与发布 v0.8.0 ✅ (2026-09-20)

- **版本统一**：workspace `Cargo.toml` / `tauri.conf.json` / `web/app.js APP_VERSION` / `web/sw.js VERSION` 全部 **0.8.0**。
- **文档**：`README.md`（徽标库/中文化/新尺寸）；`docs/CREDITS.md`（96px 缩略图、中性 EXIF 标、voigtlander/leica-apo、Instrument Serif、69 faces / 23 families）；`docs/TEMPLATE-SPEC.md`（图片层默认 0.045 + 徽标 5%/4.5%/38%）；`docs/DESIGN-LANGUAGE.md`（§3 尺寸提升 + 徽标规范新数值 + QA version 1.2.0）；PRD Discoveries 8 条；`docs/releases/v0.8.0.md`（含商标免责声明）。
- **契约 §5 回退使用记录**：§5.1（6 套 12 层徽标/字号新冲突 → 逐级回退并记录）；其余回退条款未触发。已知近似：`boxes` 盒不含 `corner` 定位与旋转外接盒，守卫跳过旋转层（属约定内的近似）。
- **发布**：本地 commit `f6731d6` → **Git Data API** 推送（1675 个 blob；本地 diff 基准 `664cc20`，远端父提交 `ac24ffa`，排除 workflow 文件）→ 远端 `main` = **`4357e00`**；annotated tag `v0.8.0` → tag object `870f802`（`refs/tags/v0.8.0`）。
- **CI/Release（tag 触发，全绿）**：`ci`（windows test+clippy/golden、wasm 字节一致、三 target）✓、`pages` ✓、`release` ✓。Release 六资产：
  `framegeist-cli-v0.8.0-win-x64.zip`（72.9 MB）、`framegeist-desktop-v0.8.0-win-x64.zip`（93.7 MB）、
  `framegeist-templates-v0.8.0.fgpkg`（19.7 MB）、`FrameGeist-v0.8.0-win-x64-setup.exe`（NSIS，93.6 MB）、
  `SHA256SUMS.txt`、`update.json`；Release URL：https://github.com/meihuaanying/framegeist/releases/tag/v0.8.0
  （CI 用 `--notes-file docs/releases/v0.8.0.md` 创建，远端 workflow 旧版本未带 notes-file，按 v0.7 惯例用 `gh release edit` 注入说明）。
- **Pages 验证**：`/` → 200、`/web/` → 200、`APP_VERSION="0.8.0"`、`sw.js` 缓存 `framegeist-0.8.0`、
  `web/brand/index.json` v2、`web/brand/thumbs/canon.png` → 200、`web/brand/exif-auto.png` → 200、`web/previews/camera-baseplate-02.jpg` → 200。
- **交付**：本地桌面端 0.8.0 构建并启动（CDP 9333 探针可用）。
