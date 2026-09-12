# FrameGeist 设计语言规范 v0.4.0

> 来源：2026-09 对 frameelf Web 编辑器 22 分类 217 套边框水印的逐类研究（研究语料仅存于临时目录，**不入仓、不复制**）。
> 本文件蒸馏的是**设计语言**（网格/字阶/层级/间距/点缀系统），不是具体版式。所有 FrameGeist 模板必须是**原创构图**：
> 禁止 1:1 复刻 frameelf 版式、禁止复制其资产/文案/预览图。学到的是语言，交付的是自己的作品。

## 1. 核心精神（六条）

1. **照片是主角**：边框/信息区只占 5–15% 面积；任何装饰不得抢视线。
2. **一眼品牌，二眼参数**：信息层级固定 —— 品牌/型号 → 镜头/参数 → 日期/地点；再往下才是装饰（印章/图标/色卡）。
3. **小字大写 + 字距 + 浅灰**：微排版是高级感的来源。所有大写微字必须开字距（0.06–0.22em），灰度 55–75%，字号最小不得在 900px 样张上低于 8px。
4. **一条基线**：同一信息带内（如底栏）所有元素垂直居中对齐同一条基线；左右两组信息用同一字号体系。
5. **大留白**：宁可少放信息。留白 5–15% 是"呼吸"，不是"浪费"。
6. **克制点缀**：一条设计里最多 1 个品牌色圆点/1 个强调色；重复信息不出现（型号出现一次即可）。

## 2. 布局原型（Archetypes）

> 模板设计从原型出发做变体，变体之间至少 2 处显著差异（布局/信息带/配色/形状），保证缩略图可区分。

### A. White Matte 白边（white-border / minimal）
```
┌────────────────────────────┐
│                            │
│           PHOTO            │
│                            │
├────────────────────────────┤
│ SONY                16mm F2.8 │
│ ILCE-7RM3A  1/1000s · ISO200  │
└────────────────────────────┘
```
- `extend` 画布；纸白 `#FFFFFF` 或奶油 `#FAF8F4`；左右 padding 0.06–0.10，上 0.08–0.14，下 0.16–0.34（相对照片高度）。
- 底带左侧：品牌 logo + 型号（可两行）；右侧：参数（可两行）；共用一条基线。
- 变体轴：白/奶油/浅灰底；底带比例；左对齐 vs 居中；参数行式 vs 四列格；含日期/不含。

### B. Master Grid 大师（master）
- 白边 + 居中品牌字标 + 手写印章（"The Master Watermark" 风格自创文案）+ 底部**四列标注参数格**：
```
  H A S S E L B L A D
     The Master Watermark
  16mm    F2.8   1/1000s   250
  FL    Aperture  Shutter  ISO
```
- 数值与标签两级字号；列间可用 1px 竖线（shape 层）分隔；顶部可加品牌红点+日期。

### C. Classic Bar 经典水印（classic-watermark）
- 白色（或纯黑）实底横条贴照片底缘，条高 0.06–0.09（相对照片高）。
- 左：品牌 logo；中：型号；右：参数。或左 logo + 右全参数。
- 变体：白条/黑条/半透明条；单行/双行；左右分置/居中分列。

### D. Borderless Corner 无边水印（borderless）
- `overlay` 直接压照片。四角分工：
  - 左上：品牌/型号；右上：参数竖排（右对齐，每项一行）；
  - 左下：参数单行；右下：日期/品牌字标。
- 全部大写微字 + 字距 + 不透明度 0.75–0.95 + `color:"auto"` 自动对比。
- 变体：居中两行（Shot on … / params）；日期大标；四角留白风。

### E. Phone Camera Bar 手机（phone）
- 厂商圆点 + 机型左，参数右；或 Apple 式卡片：品牌字形 + 两行型号/相机名 + 参数行 + 极微版权字。
- 变体：白条/黑条/照片内嵌 UI 卡片/竖排侧标。

### F. Camera Shell 相机（camera）
- 原创机身轮廓（`@builtin/frame/camera-body*`）包照片；信息融入机身丝印（型号/参数）。
- 变体：顶视条（GR 风）/复古机身（907X 风）/镜头圈刻度风。

### G. Film 胶片（film）
- 35mm 齿孔边条（`@builtin/frame/film-strip*`）+ 边码（`FRAME 4x6`、`KODAK 125PX`、计数器 `42`）+ 日期章（橙红 LED 风）。
- 变体：齿孔左右/上下；黑白暗房立柱；ILFORD/PORTRA 风格自创卷名；拍立得外框（见 M）。

### H. Fuji Recipe 富士（fuji）
- 深色/奶油参数面板；"FUJIFILM" 原创字标（已有品牌资产）+ 机型 + **标注参数格**：
  Film Simulation / White Balance / Dynamic Range / Grain / Highlight / Shadow / Color / Sharpness / ISO。
- EXIF 有则映射（ISO/机型），无则模板常量（Nostalgic Neg / Auto / DR100 …）；4 列 × 2–3 行，标签小字在数值下方。

### I. Magazine 杂志（magazine）
- 双线框（强调色 1px×2，内缩 0.02–0.03）或纯海报式大留白。
- 顶部：DESIGN BY / 日期 / NUMBER；中部衬线大标（MASTER PHOTOGRAPHY 风自创刊名）；底部：THE PHOTO OF 2026 式口号 + 细线。
- 变体：黄色双线框/白色海报/画廊海报（左文右图）/三联切片。

### J. ColorWalk / 色卡（colorwalk / colorcard）
- 照片主色向画布延伸：`background.type:"tint"` 纯色域，或模糊自身铺底；照片圆角 + 投影悬浮。
- 日期 + 参数 + **色卡条**（diamond 形色块 + hex 标签，`palette` 层自动取色）。
- 色卡分类独立：右侧竖排六边形/圆形色块 + hex。

### K. Calendar 日历（calendar）
- 大数字日期（Bebas/Oswald 0.10–0.24 照片高）+ 中文日期（乙巳（蛇）年九月廿三）+ 星期 + 月网格（小字 7 列）。
- 布局：右侧竖栏 / 底部条带 / 照片内角落。中文日期字段可由模板常量+date 表达式组合。

### L. Ticket 票根（ticket）
- 票卡：圆角矩形 + 两侧半圆缺口 + 虚线齿孔 + 条码（原创生成 PNG）+ `TICKET STUB / THIS STATION / CITY / 日期 / NO.`。
- 背景为低饱和纯色（灰粉/灰蓝/墨绿/暖黑），票卡可倾斜（rotation 5–8°）。

### M. Polaroid / Stamp 拍立得（polaroid）
- 邮票：齿孔边（perforation 资产）+ 大数字 + 中文日期 + 地点；或经典拍立得白框 + 粉彩底。

### N. Festival 节日（festival）
- 红金体系 `#C8102E / #D4A017`；毛笔年份（Ma Shan Zheng "2026"）+ 红印章（原创 seal 资产）+ 节日图标行（龙舟/灯笼自创矢量）+ HAPPY NEW YEAR 竖排。

### O. Sports / Geo 运动（sports / drone）
- 地点（中英）+ 海拔（`gps_alt`）+ 速度/里程；运动模糊大图；参数与地理信息分列。
- 无人机：航拍 + GPS 经纬度（`gps_latlon`）+ 飞行参数 + 品牌字形。

### P. Effect / Blur 特效 / 模糊（effect / blur-bg）
- 模糊自身铺底（`background: blur`）+ 圆角投影照片（canvas radius/shadow）；或色域渐变延伸（tint）。
- 变体：镜像倒影/双色渐变/暗角卡片。

## 3. 字阶系统（相对照片高度比例）

| 角色 | 字体 | 字号 | 字距 | 颜色 |
|---|---|---|---|---|
| 品牌字标 | Inter / Space Grotesk | 0.020–0.028 | 0.10–0.20em | 墨黑 #1A1A1A |
| 机型 | Inter / Noto Sans SC | 0.013–0.018 | 0.02–0.06em | 墨黑/次级 #373A40 |
| 参数行 | JetBrains Mono / Inter | 0.012–0.016 | 0.02–0.08em | 次级 #6B7280 |
| 微标签 | Inter | 0.008–0.011 | 0.10–0.22em | 浅灰 #9AA0A6 |
| 衬线大标 | Playfair / Cormorant / Noto Serif SC | 0.05–0.16 | 0.02–0.08em | 墨黑/纸白 |
| 大数字 | Bebas Neue / Oswald | 0.10–0.24 | 0.00–0.04em | 墨黑/强调 |
| 手写印章 | Great Vibes / Ma Shan Zheng | 0.020–0.040 | 0 | 墨黑/红 |
| 中文标题 | Noto Serif SC / Ma Shan Zheng | 0.030–0.080 | 0.05–0.15em | 墨黑/纸白 |

## 4. 色彩体系

- 纸：`#FFFFFF` / 奶油 `#FAF8F3` / 暖灰 `#F2F0EC` / 浅灰蓝 `#EDF1F5`
- 墨：`#1A1A1A` / `#373A40` / 次级 `#6B7280` / 微 `#9AA0A6`
- 线：`#E4E6EA`（浅底）/ `rgba(255,255,255,0.35)`（深底）
- 强调：品牌红点 `#E10600`（Leica/Sony 系）、杂志黄 `#FFD100`、节庆红 `#C8102E`、金 `#D4A017`
- 浅色底一律不用纯黑字（用 #1A1A1A）；深色照片上文字用 `color:"auto"`。
- **禁紫**（见 AGENTS.md 红线）。

## 5. 信息映射（EXIF → 设计）

| 设计槽位 | 表达式 | 备注 |
|---|---|---|
| 品牌 logo | `@builtin/brand/{exif.brand_slug}` | 已有 63 slug |
| 系列徽章 | `@builtin/series/{exif.lens_series}` | GM/L/Art 等 |
| 机型 | `exif.model_pretty` | 美化映射 |
| 参数 | `exif.focal` / `aperture` / `shutter` / `iso` | 单位自带 |
| 日期 | `date('YYYY.MM.DD', exif.datetime)` 等 | token 见 TEMPLATE-SPEC |
| 星期 | `date('WW', exif.datetime)` / `exif.weekday_cn` | v0.4 新增 |
| 坐标 | `exif.gps_lat` / `gps_lon` / `gps_latlon` / `gps_alt` | v0.4 新增（默认剥离，模板字段仍在） |
| 富士配方 | 模板常量 + ISO/机型 | 无 EXIF 配方字段 |

格式惯例：参数用 `·` 或固定宽间隔（`16mm · F2.8 · 1/1000s · ISO200`）；日期三种风格（点分 `2026.08.19` / 连字符 `2026-08-19` / 英文长写 July 15th, 2026）。

## 6. 原创资产清单（gen-frame-assets.mjs 扩展）

- `brand/*.png`（现有 63 + 扩展）与 `-light` 变体；`series/*`；`game/*`。
- `frame/` 新增：`film-strip-35`（横/竖齿孔）、`film-edge`（边码条）、`stamp-perforation`（邮票齿孔）、`ticket-notch`（票卡缺口，用于叠加）、`barcode`（原创 EAN 风条码）、`seal-red`（朱文方印/圆印）、`icon-*`（龙舟/灯笼/山/相机/无人机自创线性图标）、`rule-*`（细线/双线装饰）。
- `texture/` 可选：纸纹（极淡噪点）。

## 7. 每套模板 QA 清单（必须全部满足）

1. CLI 真实 EXIF 照片渲染，900px 样张上最小文字 ≥ 8px 且可读。
2. 无意外重叠；信息带同一基线；留白在 5–15%。
3. 浅底/深底两张照片下 `auto` 对比度均通过。
4. 表达式全部过白名单；`validate` 无错。
5. id 唯一、name/nameI18n 双语、category 正确、author="FrameGeist"、license="CC0-1.0"、version="1.0.0"、minEngineVersion="0.4.0"。
6. 与同分类相邻模板至少 2 处显著差异（自动缩略图差异断言 >3%）。
7. 无 frameelf 文案/资产复刻；无第三方商标图形描摹（品牌字标走 Simple Icons 既有管线）。
