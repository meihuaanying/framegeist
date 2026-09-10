# FrameGeist 拼图布局规格（LAYOUT-SPEC）

> 版本 v0.1 ｜ 对应引擎 `framegeist-core` v0.1.x（PRD C5）
> 布局是**声明式 JSON**，与模板共享同一套沙箱规则（禁止网络/路径跳出）。

## 文件与限制

| 项 | 限制 |
|---|---|
| 布局 JSON 体积 | ≤ 64 KB |
| `cells` 数量 | 1–25（对应 5×5 网格上限） |
| 未知字段 | 一律拒绝 |
| `meta.id` | 3–64 字符，`[a-z0-9-]` |
| `meta.version` | semver |

## 结构

```jsonc
{
  "meta": { "id": "grid-2x2-info", "name": "Grid 2 x 2 + EXIF", "version": "0.1.0",
             "author": "framegeist", "license": "CC0-1.0", "slots": 4 },
  "cells":  [ { "x": 0, "y": 0, "w": 0.5, "h": 0.5 }, ... ],
  "gutter": 0.012,
  "background": "#FFFFFF",
  "aspect": 1,
  "info_bar": { "enabled": true, "height": 0.075, "color": "#FFFFFF", "text_color": "#555555" }
}
```

## 语义

| 字段 | 语义 |
|---|---|
| `cells[]` | 每格为画布比例矩形；`x/y ∈ [0,1)`，`w/h ∈ (0,1]`，`x+w ≤ 1`、`y+h ≤ 1`（1e-9 容差） |
| `gutter` | 格间隙（相对画布宽/高），`[0, 0.2]`；格矩形向内收缩 `gutter` |
| `background` | 底色，`#RRGGBB[A]` |
| `aspect` | 画布宽高比（宽/高），`[0.2, 4.0]`；画布固定宽 3000px（v0 口径，后续可配置） |
| `info_bar` | 每格底部 EXIF 信息条：`model_pretty + f/光圈 ISO`，字体取注册字体回退链第一项 |

## 填充规则

- 照片按传入顺序填入 `cells`；多出的照片忽略，未填的格保持底色。
- 每格照片 **cover-fit**（等比放大裁切充满格矩形），不做降采样之外的缩放权衡（B1）。
- 输出元数据来自**第一张照片**（清理后的 EXIF 回写，JPEG q100+4:4:4 / PNG eXIf）。

## 库配额（C5 验收）

- `templates/layouts/` 内置 ≥ 100 套（当前 106）：方网格 1×1–5×5（含 EXIF 信息条双变体）、横/竖长条 strip 2–6、非对称 hero 布局（1+2/1+4/1+6/1+8）、金字塔/对角线特殊布局。
- 由 `tools/gen-layouts.mjs` 确定性生成，测试 `framegeist-cli/tests/collage.rs` 锁配额与确定性。

## v0.2.0 说明

- 拼图输出为固定长边 3000px 的 JPEG（元数据取第一张照片）；画布比例/背景/翻转/字体等
  **渲染覆盖仅作用于模板模式**，拼图布局由 `cells`/`gutter`/`aspect` 自身声明决定。
- 布局选择器在应用内以生成的 SVG 示意图展示（`web/layout-thumbs/`）。
