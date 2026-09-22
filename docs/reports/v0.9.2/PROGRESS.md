# FrameGeist v0.9.2 Progress（补丁：预览居中 + Canon 官方红）

> 触发：用户反馈 —— ① 佳能徽标不对（黑色，应为官方红）；② 预览默认打开时应居中且不被遮挡。
> 基线：v0.9.1（`b3f6468`）。本补丁只改 Web 视图层与 Canon 资产，引擎/模板 JSON/引擎测试零改动。

## 修复内容 ✅ (2026-09-22)

### 1. 预览居中（严重，影响编辑器默认打开体验）

- **根因**：`web/styles.css` 的 `.canvas-wrap` 同时设置了 `position:absolute; inset:0; display:grid; place-items:center`，
  会把子 `<img>` 在其自身坐标内**再居中一次**，与 `fitStage()` 写入的 `translate(tx,ty)` 叠加 → 模板预览图（无照片时）
  向右下偏移（实测 +172/+99px）且底部被裁（未完全可见）。
- **修复**：移除 `.canvas-wrap` 的 grid 居中（`transform` 是唯一的定位来源）；舞台 img 的布局原点回到 (0,0)。
- **实测**：模板预览与照片两种路径现在均精确居中（dx/dy ≤ 1px）且完全可见。
- **E2E 防回归**：新增「editor: template preview is centered and fully visible」（无照片时进入编辑器，断言图片中心与
  视口中心偏差 ≤3px、且完整落在视口内）。

### 2. Canon 徽标改为官方红（用户反馈）

- **背景**：Simple Icons 已下架 Canon，项目按契约使用原创排版字标（Cormorant Garamond 600），但主变体为**黑色**，
  用户反馈「logo 不对」。Canon 官方红为公开的品牌色（Pantone 186 C ≈ `#C8102E`），本次将其作为**原创字标的着色**恢复。
- **实现**：`tools/brand-colors.json` 新增 `originalColorOverride`（当前仅 `canon: #C8102E`）；
  `tools/gen-brand-assets.mjs` 的 `colorFor()` 支持该覆盖并新增 `--only <slug>` 定向重渲模式（避免全量脚本在网络抖动时
  误覆盖官方图标）；重渲 `brand/canon` 与 `lockup/canon` 的主变体（红）+ `-mono`（黑）+ `-light`（白），512px + 96px。
- **清单**：`web/brand/index.json` / `web/lockup/index.json` 的 canon 条目 `color: "#C8102E"`（camera + lens 两组）；
  `CREDITS.json` 增加 `originalColorOverride` 说明。**字形仍为原创排版、非官方矢量**（不复制官方图形徽记）。
- **门禁**：`check-brand-colors` 扩展为校验覆盖品牌（主变体饱和度/色相、mono 黑、light 白）→ **131/131**；
  E2E 新增「canon wordmark carries the official red」（品牌 + lockup 缩略图）。
- **视觉**：Canon 出现在大量样片的徽标层 → 样片全量重渲（192/192）与视觉基线**有意重生成**（384 项，原因：Canon 主变体黑→红）。

## 门禁

- E2E **273/273**（v0.9.1 的 271 + 预览居中 + Canon 红）；其余门禁与 Rust 工作区测试全绿。
- 引擎、模板 JSON、WASM 包均未改（wasm 字节与 Golden 基线不变）。

## 发布与验证 ✅ (2026-09-22)

- **版本统一**：`Cargo.toml` / `tauri.conf.json` / `web/app.js APP_VERSION` / `web/sw.js VERSION` 全部 **0.9.2**。
- **本地提交** `72b046b` → **Git Data API** 推送（214 条目；本地 diff 基准 `0f33a4c`，远端父提交 `b3f6468`，排除 workflow）→ 远端 `main` = **`41cd6bd`**；annotated tag `v0.9.2` → tag object `319cb7e2`（`refs/tags/v0.9.2`）。
- **CI/Release/Pages（全绿）**：`ci`（windows test+clippy/golden、wasm 字节一致、三 target）✓、`pages` ✓、`release` ✓。Release 六资产：
  `framegeist-cli-v0.9.2-win-x64.zip`（74.0 MB）、`framegeist-desktop-v0.9.2-win-x64.zip`（94.3 MB）、
  `framegeist-templates-v0.9.2.fgpkg`（19.7 MB）、`FrameGeist-v0.9.2-win-x64-setup.exe`（NSIS，94.1 MB）、
  `SHA256SUMS.txt`、`update.json`（`latest.version = v0.9.2`，192 模板）；说明经 `gh release edit --notes-file docs/releases/v0.9.2.md` 注入。
  Release URL：https://github.com/meihuaanying/framegeist/releases/tag/v0.9.2
- **Pages 验证**：`APP_VERSION="0.9.2"`；`sw.js` 缓存 `framegeist-0.9.2`；`styles.css` 中 `.canvas-wrap` 的 grid 居中规则已移除；
  `brand/index.json` 的 canon `color="#C8102E"`（official=false）。
- **交付**：本地桌面端 0.9.2 重建（2m05s）并启动（CDP 9333；就绪、192 套模板、五 Tab 面板齐全、无品牌条）。

