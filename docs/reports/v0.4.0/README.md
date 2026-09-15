# FrameGeist v0.4.0 冲刺报告

> 日期：2026-09-12 ｜ 主题：**design-first** —— 深研 frameelf 后全部模板推倒重做 + 模板墙 → 编辑器主导流程 + 真实摄影预览 + 引擎设计语言能力补齐。

## 结果总览

| 项 | 结果 |
|---|---|
| 模板库 | **184 套 / 25 分类**（166 套新设计 + 18 套游戏；目标 180+） |
| 引擎 | A1–A9 全落地：字距（em）、旋转、文本透明度、形层、色卡层、画布圆角/投影、tint 底色、GPS/星期/日期 token、25 分类枚举 |
| 主导流程 | 首屏**模板墙**（27 tabs / 搜索 / 响应式 2–4 列 / hover 使用+放大镜 / 导入照片）→ **编辑器**（右栏手风琴 / 返回 / 无照片显示真实占位预览） |
| 真实摄影 | 11 张 Picsum（风光×3 / 建筑×2 / 街景 / 雾气 / 黄昏城市 / 人像 / 人物 / 方形草莓）；samples 900 + previews 640 + thumbs 240 共 552 张重渲染 |
| E2E | **57/57**（门禁 ≥45） |
| Rust 门禁 | `cargo test --release --workspace` 全绿；`clippy --workspace --all-targets -- -D warnings` 零告警 |
| WASM | 与 CLI 帧渲染**字节一致**；拼图跨端像素差 0.000013（门禁 ≤0.001） |
| 性能 | 24MP 预览 231ms（≤600ms）；24MP 导出 0.69s（≤2s）；60MP 导出 1.27s（≤4s） |

## 关键交付

- **设计语言**：`docs/DESIGN-LANGUAGE.md`（22 分类 217 套 frameelf 蒸馏；研究语料不入仓）。
- **引擎**：`template.rs`（新层/字段/校验）、`render.rs`（自绘文本渲染器 + 形层 + median-cut 色卡 + tint + 圆角/投影 + GPS 门控 + 声明顺序绘制）、`exif.rs`、`sandbox.rs`；回归 `crates/framegeist-cli/tests/engine_v040.rs`（10 项）。
- **模板**：7 个子 Agent 波次 163 套 + 3 套黄金范例；24 张分类接触表逐张视觉审计；旧 239 套清理，3 套手写种子迁 `tests/fixtures/`；`gen-templates.mjs` 改为扫描式 manifest + 镜像，`gen-extras.mjs` 退役。
- **工具**：`tools/validate-templates.mjs`（全量校验+渲染）、`tools/make-contact-sheets.ps1`、`tools/gen-frame-assets.mjs` 扩展（齿孔/边码/邮票/票卡/条码/印章/图标）。
- **UI**：`web/index.html` + `styles.css` + `app.js`（wall/editor 双视图、i18n 25 分类 + wall keys、占位预览、fit/transition 修复）。

## 截图（`docs/reports/v0.4.0/`）

- `00-editor.png` — 模板墙进入编辑器（真实占位预览 + 右栏）
- `01-frame-dark-24mp.png` / `03-frame-light-24mp.png` — 24MP 渲染（深/浅）
- `02-bg-solid.png`、`04-collage-dark.png`、`05-lightbox.png`、`06-settings.png`

## 已知取舍

- 黄金基线保留在 3 套 fixtures 模板上（内容不变，语义变更已在此前重生成并注明）——新模板的回归由 `engine_v040` + `templates_all_valid` + E2E 覆盖。
- 模板墙排序为分类导航序（white-border → … → game），同类内按名称。
- 发布已执行：commit → tag `v0.4.0` → Release 六资产 → CI 全绿 → Pages 在线验证通过。

## 发布后审查补丁（2026-09-13）

v0.4.0 发布后自查软件与官网，修复并复验：

1. **Service Worker 未注册**（离线/PWA 实际失效）→ 仅在 Web 源注册（Tauri 跳过）；缓存策略改为壳层 network-first、模板/布局 stale-while-revalidate、静态资源 cache-first，cache 版本升 `framegeist-0.4.0`。
2. 模板墙排序改分类导航序（white-border → … → game），不再从黑框开场。
3. 无预览模板（用户导入）占位预览失败时回退显示模板名。
4. 官网模板墙：分类与名称双语 + 数量；首屏 "60+" 文案更正 184 套/25 分类；样张说明改真实摄影。
5. 官网下载页 <1MB 文件按 KB 显示。
6. `manifest.webmanifest` 主题色/图标/描述更新。
7. E2E 竞态加固：等待渲染图解码完成再测覆盖率（消除偶发 coverage=0 假红）。
8. 编辑器 ≤920px 单列回退；卡片网格补键盘焦点可见性。

桌面重建后 **E2E 57/57** 复跑通过；补丁仅入 main，不重发 v0.4.0 Release 资产。
