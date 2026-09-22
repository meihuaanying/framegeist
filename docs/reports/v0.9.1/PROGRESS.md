# FrameGeist v0.9.1 Progress（补丁：侧边栏面板修复 + 墙顶品牌条移除）

> 触发：v0.9.0 用户反馈 —— ① 侧边栏「元素 / 画布 / 导出」三个 Tab 空白；② 模板墙顶部品牌展示条需移除。
> 基线：`41b9fca`（v0.9.0 收尾 docs）；本补丁不改变引擎与渲染输出（无视觉基线变动）。

## 修复内容 ✅ (2026-09-22)

### 1. 侧边栏面板空白（严重，v0.9.0 回归）

- **根因 A（HTML 嵌套）**：`web/index.html` 中 `templates` 与 `canvas` 两个 `.side-panel` `<section>` 漏闭合 →
  浏览器把 canvas/elements/photo2/export 四块面板解析为**嵌套**在前两个面板内部；`setSideTab()` 虽正确切换 `.on`，
  但祖先面板 `display:none`，导致元素/画布/导出三个 Tab 完全不可见（只有 templates 与 photo 恰好是顶层）。
  修复：补齐两处 `</section>`；新增 E2E 断言「所有 `.side-panel` 必须是 `.side-panels` 直接子元素」。
- **根因 B（卡片分组错位）**：`#insertCard`/`#layersCard`/`#propsCard` 物理上被放在画布面板中（契约附录 D 要求属于「元素」Tab）。
  修复：把三张卡移入 elements 面板；现分组 = 模板（templateCard/layoutCard）· 照片（dropzone + exifEditCard/exifCard）·
  元素（insert/layers/props/tweak/watermark）· 画布（canvas/cardFx/frame/crop）· 导出。
- **E2E 升级**（不减少断言数，271 → 271）：
  - 「v0.9 sidebar: every tab shows its panel」——逐个切换 5 个 Tab，断言其全部面板 `offsetParent !== null` 且高度 > 0、
    非当前 Tab 的面板不可见、无嵌套面板、元素/属性卡可见（旧断言只看 `.on` 类与自身 `display`，因此漏检）。
  - 该检查在旧代码上可复现失败（tabs 3/5 空白），修复后通过。

### 2. 模板墙顶部品牌展示条移除（用户要求）

- 移除 `web/index.html` 的 `#wallBrandStrip` 与 `web/app.js` 中 `buildWall()` 的填充调用（保留灯箱 `#lbBrand` 品牌条与
  `templateBrandSlugs()` 回退品牌组；卡片品牌标记保留）。
- E2E：原「wall brand strip shows brand marks」改为「v0.9.1 ui: wall top brand strip removed」（灯箱品牌条断言继续保留）。

### 3. E2E 稳定化（探针侧）

- §43 ungroup 用例改为按稳定 id（`brandmark` + `model`，缺失时回退前两行）选取图层，消除跨次运行 localStorage 累积改动
  导致的选层漂移（修复前偶发 drift >100px 的假失败，非产品缺陷）。

## 门禁

- 复测（修复后）：E2E **271/271**（`docs/reports/v0.9.1/` 截图归档）；卡组/穿透/锁层/导出条等全部 v0.9 断言不回归。
- `check-utf8` 0 损坏；`check-i18n` 485/485（`brand.aria` 仍被灯箱使用）；引擎/模板/资产零改动（wasm 字节与视觉基线不受影响）。
- 本地桌面端重建（0.9.1）并启动验证。
