# FrameGeist v0.5.0 — 发布报告

> 契约：`docs/V0.5.0-CONSTRAINTS.md`（一口气版）。里程碑进度：`PROGRESS.md`；功能对齐：`PARITY.md`（**14/14 ✅**）。

## 一句话

192 张全局唯一展示照片、8 款自创艺术字效、frameelf 全编辑器功能对齐（含日历/相框制作/自由拼图）、cosmic-text 0.19 排版、交互三件套（直操+吸附 / 多选群组 / 双模面板）、E2E 158 条与四 target 全绿，v0.5.0 六资产 Release + Pages 在线。

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | cosmic-text wasm spike | ✅ |
| M1 | 照片唯一化管线（192/192 唯一，`check-photo-uniqueness` 全绿） | ✅ |
| M2 | cosmic-text + 字效矩阵 + 新图层（divider/group/calendar）+ Fuji EXIF + 导出选项 | ✅ |
| M3/M4 | 编辑器 UI：两档面板 / 画布直操吸附 / 图层 / 撤销重做 / 相框 / 裁切 / 背景画幅 | ✅ |
| M5 | 日历 + 相框制作 + 自由拼图编辑 | ✅ |
| M6 | 模板接入新能力 + 192 接触表视觉审计 + PARITY 缺口关闭 | ✅ |
| M7 | 全量门禁（测试 / clippy / wasm-smoke / 四 target / 性能 / E2E） | ✅ |
| M8 | 文档 + 报告 + 发布 | ✅ |

## 交付物

- 引擎（Rust core）：cosmic-text 0.19 + swash 排版（`--legacy-text-renderer` 回退）；字效矩阵（描边/白边/双线/压印/浮雕/letterpress/内阴影/渐变/烫金/纹理/case/flip/stretch/span:auto/autoHide）；`group`/`calendar`/`shape`/`image` 图层；`layer_boxes`；相框空白窗口检测 + cover 适配 + rotation；自由拼图（圆角/描边/单图裁切）；覆盖项 tint/margin/texture/card(内外阴影/圆角/边框)。
- Web/PWA：模板墙（192 套 / 25 分类 / 双语 / 搜索 / 最近使用 / 我的模板）；编辑器全量模块（见 PARITY.md）；自由拼图（拖/缩/转/层级/交换/间隔/单图裁切）；导出 720P–6K + 元数据开关 + 批量去重。
- 模板：192 套（含 8 艺术款、日历真层 5 套、autoHide 分割线 6 套、标题字效 4 套），每套唯一展示照片（Picsum + 11 演示图，CREDITS 齐全）。
- 三端：CLI（render/pixel-diff/pixel-hash/template-export/import）、WASM（`web/pkg`）、桌面（Tauri）。

## 门禁证据（2026-09-16，最终 revision）

| 门禁 | 结果 |
|---|---|
| E2E `tools/e2e-audit.mjs`（headless Edge + CDP，无页面错误硬门禁） | **158/158**（门禁 ≥70） |
| `cargo test --release --workspace` | 全绿（core 17 / engine_v050 14 / exif 9 / template_validation 3 / fuzz / CLI 等） |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0 |
| WASM↔CLI `wasm-smoke` | 帧渲染字节一致；拼图差 0.000013（≤0.001） |
| 四 target（msvc / wasm32 / aarch64-linux-android / aarch64-unknown-linux-ohos） | 全 ✅ |
| 性能（契约 §4） | 24MP 预览 168ms / 导出 1032ms；60MP 预览 638ms / 导出 2696ms，4/4 PASS |
| `check-photo-uniqueness.mjs` | PASS（192/192 唯一、方向/明暗规则、零 test 照片泄漏） |
| 视觉审计 | 26 张分类接触表 × 192 samples 人工目视；变更 10 类重做；相邻同类缩略图差异 167 对 min 38.90%（>3% 门禁） |
| PARITY | 14/14 模块 ✅ |

## E2E 截图（docs/reports/v0.5.0/）

`00-editor` 编辑器双栏 / `01-frame-dark-24mp` 相框 24MP / `02-bg-solid` 背景 / `03-frame-light-24mp` / `04-collage-dark` 模板拼图 / `05-lightbox` / `06-settings` / `07-free-collage` 自由拼图 / `08-card-fx` 卡片特效面板 / `09-watermark` 水印调整面板 / `10-background` 背景面板（色板/取色）。

## 已知粒度（如实记录，非未完成项）

1. **水印调整**：全局高度/边距/间隔在专用面板；单元素调整复用元素属性面板（面板内提供选中入口）。
2. **自由拼图间隔/边距**：滑杆 + 重排按钮（网格保持照片顺序），非拖拽实时重排。
3. **Fuji LUT1/LUT2**：Fujifilm MakerNote 无对应标签，隐藏不造假；NR/clarity 已尽力解析。
4. **日历装订线**：`binding` 装饰性辅助线（虚线折痕 + 顶缘装订标记），非物理打孔。
5. `calendar-corner-day-01` 保留文字版日历（overlay 照片上对比度不可控）。

## 发布

- 版本：Cargo workspace / tauri.conf / web `APP_VERSION` = **0.5.0**；SW 缓存 `framegeist-0.5.0`。
- Tag `v0.5.0` → CI `release.yml`：CLI zip、桌面 zip、模板 `.fgpkg`、NSIS 安装器、SHA256SUMS.txt、update.json（六资产）。
- Pages：`site/` 模板墙/下载页/更新信息。
