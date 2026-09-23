# FrameGeist v0.9.3 Progress（补丁：Canon 官方字形 + 手机品牌独立分组）

> 触发：用户反馈 —— ① Canon 字标需更接近官方字形（v0.9.2 的 Cormorant 过于纤细）；② 徽章库把手机品牌单独分组。
> 基线：v0.9.2（`f8de13a`）。本补丁改 Web 视图层 + 品牌资产 + 库清单（manifest v4），引擎/模板 JSON 零改动。

## 修复内容 ✅ (2026-09-22)

### 1. Canon 字标字形（用户提供官方图对照）

- **字体替换**：`CormorantGaramond-600`（高对比、纤细）→ **`NotoSerifSC-700.otf`（过渡衬线、厚重、中等对比）**，
  与官方 Canon 字标的笔画厚度/衬线风格更接近；字距 `-2` 收紧。仍为**原创排版渲染**（不复制官方矢量），官方红 `#C8102E` 保持。
- 定向重渲 `brand/canon` 与 `lockup/canon` 三变体（512px + 96px）；`CREDITS.json` 字标字体与备注同步。
- 视觉：样片全量重渲（192/192）与视觉基线**有意重生成**（384 项，原因：Canon 字形更换）。

### 2. 徽章库手机品牌独立分组（manifest v4）

- 清单 `web/brand/index.json` / `web/lockup/index.json` → **version 4**，新增 `phone` 组：
  **相机 18 · 手机 10 · 镜头 28 · 系列 13 · 游戏 6**（全部 75，原「全部 85」含跨组重复的相机品牌，现手机从相机/镜头组中移出）。
- 手机品牌：apple / google / honor / huawei / motorola / nokia / oneplus / oppo / samsung / vivo。
- Web：`BRAND_GROUPS` 增加 `phone`（chip 顺序：全部 → 相机 → 手机 → 镜头 → 系列 → 游戏）；i18n 新增
  `brandLib.groups.phone`（手机品牌 / Phone brands，486 键对齐）；品牌/锁扣层的默认分组候选含 phone。
- 生成器：`PHONE_SLUGS` + manifest v4 输出（相机组排除手机；镜头组不再含手机）；`--only` 定向重渲保持可用。
- 门禁：`check-brand-colors` 改为校验相机+手机+镜头三组去重后的全部品牌（变体矩阵 + 颜色）→ **169/169**；
  E2E 更新为 v4/五组 + 新增「手机品牌独立分组」断言（10 项全为手机品牌）。

### 3. 取消分组位置漂移（引擎 API + 编辑器，发现于 E2E 复测）

- **根因**：`ungroupSelected()` 用**舞台图片**的自然尺寸（`imgRect().nw/nh`）把组内相对偏移换算回画布偏移。
  渲染进行中/失败时舞台显示的是**原图**（像素尺寸与画布输出不同），换算比例错误（实测 1228×2160 原图 vs 1964×3456 画布 → 1.6× 放大），
  导致 group→ungroup 后图层位置漂移（E2E 偶发假失败、真实用户场景也会中招）。
- **修复**：`framegeist-wasm` 新增 `canvas_size(photo, template, overrides) -> "[w,h]"`（复用 core 既有
  `canvas_size_for_photo`）；`editor.js` 新增 `canvasFrame()`，取消分组与对齐/分布（`applyBoxDeltas`）改用引擎画布尺寸，
  引擎不可用时回退舞台尺寸。
- **验证**：干净状态下以「舞台显示原图」的时序复现漂移（82.9/2332.8px）→ 修复后 **0/0**；E2E ungroup 断言恢复稳定。
- WASM 重新构建（`node tools/wasm-build.mjs`）：帧字节一致、拼图 0.000013；模块 **5,060,886 B**。

## 门禁

- E2E **274/274**（v0.9.2 的 273 + 手机分组）；`check-i18n` 486/486；其余门禁与 Rust 工作区测试全绿。
- 模板 JSON 未改；引擎核心未改（仅 wasm 新增只读 API，渲染输出不变）。
