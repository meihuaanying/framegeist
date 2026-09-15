# FrameGeist v0.5.0 PARITY

> Contract §3.1 module × feature checklist. Verified 2026-09-16 against `web/` + `crates/framegeist-core`. **Status: 14/14 modules complete** — release gate §5.6 satisfied. Documented-granularity notes are marked ⓘ (functionality present with a stated implementation choice); nothing is skipped silently.

## Module matrix

| # | Module | Status |
|---|---|---|
| 1 | 模板 | ✅ 5/5 |
| 2 | 背景 | ✅ 8/8 |
| 3 | 相框 | ✅ 8/8 |
| 4 | 画幅 | ✅ 3/3 |
| 5 | 卡片特效 | ✅ 5/5 |
| 6 | 元素添加 | ✅ 7/7 |
| 7 | 水印调整 | ✅ 3/3 ⓘ |
| 8 | 图层管理 | ✅ 13/13 |
| 9 | 裁切 | ✅ 6/6 |
| 10 | 日历 | ✅ 5/5 |
| 11 | 拼图 | ✅ 9/9 ⓘ |
| 12 | 导出 | ✅ 4/4 |
| 13 | EXIF | ✅ 4/4 ⓘ |
| 14 | 历史 | ✅ 1/1 |

## 1. 模板 ✅

分类 `app.js:284-289,311-324,431-444`; 搜索 `index.html:40,68` + `app.js:294-302`; 最近使用 `fg-recent-v1` ring buffer (≤12, most-recent-first) + chip; 我的模板 `fg-user-templates-v1` `app.js:1032-1056,1130-1156`; 双语名 `app.js:304-306` + 192 manifest entries.

## 2. 背景 ✅

blur/solid/image/none `render.rs`; 自动取色 tint（覆盖 `background:"tint"` → 照片均值）; 预设色板 + 复古中性色 swatch row; 画布取色 eyedropper（离屏 canvas 采样）; 纹理 background（`BgKind::Texture` + `textureAsset` 覆盖，无资产时确定性纸纹）; 圆角/阴影组合通过卡片面板（overrides.card 复用 canvas radius/shadow 绘制路径）。

## 3. 相框 ✅

内置库 30 PNG / 15 slugs（`web/frame/`）+ 编辑器网格选择器; 上传 PNG; 空白区域检测（透明窗口最大内接矩形）; cover 裁切适配; 缩放/内缩/offset X-Y/rotation（`canvas.frame.rotation` 引擎新增）全部可达。

## 4. 画幅 ✅

边距 0–0.5 覆盖 `margin`（addition 到 canvas.padding，随 aspect 扩展一致）; 比例 原图/1:1/4:3/3:2/16:9/9:16; 自适应 `expand_to_aspect`。

## 5. 卡片特效 ✅

面板 `#cardFxCard`：启用开关 + 低配提示; 圆角 0–0.25; 外阴影 blur/opacity/offset; 内阴影 blur/opacity（引擎 `draw_card_inner_shadow`，E2E 像素断言）; 边框宽度/颜色。`card.enabled:false` 完全还原模板默认。

## 6. 元素添加 ✅

文字 / 图片（上传 → `@user/insert-*` 资产 + ImageLayer，可选中拖动）/ 线型（直线/双线/对向边框/分割线 + autoHide）/ 色卡 / 群组 + 取消编组 / 日历。

## 7. 水印调整 ✅ ⓘ

专用面板（classic-watermark 分类显示）：全局高度（fontSizeScale）、边距（paddingScale）、间隔（对所有文本层应用 letterSpacing）。ⓘ 单元素调整走既有元素属性面板（面板内提供「选中首个文本层」入口），非重复造第二套控件。

## 8. 图层管理 ✅

列表/内联重命名/显隐/锁定/层级（上移下移置顶置底）/shift 多选/编组/取消编组/删除/复制/对齐（左中右+上中下）/分布（水平/垂直等间距）。

## 9. 裁切 ✅

画布双击照片进入裁切（未命中照片时保持 fitStage）; 比例锁定; 重置; 填满宽度/高度; 自由拼图选中项单图裁切（item crop，引擎支持）。

## 10. 日历 ✅

月历网格; 阴历 1900–2100 查表（无数据不显示）; 装订边辅助线（`binding`，虚线折痕 + 顶缘装订标记）; 天/周/月元素（view month/day/strip/week，图层可拖拽）; 布局预设按钮（月历/大日子/横条/周视图 + 强调色 swatches）。

## 11. 拼图 ✅ ⓘ

模板拼图 106 layouts; 自由拼图：拖拽/缩放/旋转/层级/增删/交换（shift 选两项，fallback 首尾）/圆角/描边/背景/比例切换/单图裁切。ⓘ 「间隔/边距」以「间隔+边距滑杆 + 重排按钮」实现（重排按网格保持照片顺序，边距四边生效），非拖拽实时重排。

## 12. 导出 ✅

720P/原图/2K/4K/6K/自定义长边（actionbar + 设置对话框一致）; 元数据开关（GPS 默认剥离）; 批量; 文件名去重。

## 13. EXIF ✅ ⓘ

面板 9 键（缺失显示 "—" 不造假）+ Fuji 配方分组（仅显示解析到的键）; 引擎解析 film mode / wb mode / wb shift / grain / chrome FX blue / dynamic range / highlight & shadow tone / sharpness / saturation / noise reduction / clarity。ⓘ `LUT1/LUT2`（+透明度）无 Fujifilm MakerNote 标签（ExifTool 亦无），保持 `None` 隐藏，已在 `exif.rs`/TEMPLATE-SPEC 注明，不编造。

## 14. 历史 ✅

`MAX_HISTORY = 60`（≥50）; 命令合并; Ctrl+Z/Y; 每模板独立栈。

---

## v0.5.0 engine extras (beyond §3.1)

cosmic-text 0.19 shaping + `--legacy-text-renderer`; 字效矩阵（描边/白边/双线、压印/浮雕/letterpress/内阴影、渐变/烫金/纹理、case/flip/stretch、span:auto、autoHide）; 8 艺术预设; 组/日历/线型图层; `layer_boxes`; 相框窗口检测; 自由拼图引擎（圆角/描边/crop）; 720P + 元数据; 192 唯一照片管线; 相邻同类缩略图 >3% 门禁（E2E §40）。

## Verification snapshot (2026-09-16)

- E2E `tools/e2e-audit.mjs` (headless Edge/CDP, no page errors): **158/158**，含 §40 相邻差异、§47-62 新控件像素断言。
- `cargo test --release --workspace` 全绿；`clippy -D warnings` exit 0。
- WASM↔CLI：帧字节一致；拼图差 0.000013（≤0.001）。
- 性能与四 target：见 PROGRESS.md M7 复核记录。
