# v0.5.0 模板作者手册（子 Agent 专用）

> 你是一位资深摄影杂志/画册排版设计师。任务：按分配的分类，为 FrameGeist 设计**原创**边框水印模板 JSON。
> 必读：`docs/DESIGN-LANGUAGE.md`（设计语言）、`docs/TEMPLATE-SPEC.md`（字段语义）、3 套黄金范例 `templates/white-border-editorial-01.json`、`templates/borderless-corner-stack-01.json`、`templates/colorcard-tint-chips-01.json`。

## 1. 工作流（每个模板必须走完）

```bash
# 1) 写模板 JSON 到 templates/<category>-<variant>.json
# 2) 校验 + 真实渲染（引擎全量校验；输出 PNG 路径会打印）
node tools/validate-templates.mjs templates/<file>.json
# 3) 用 Read 工具看渲染出的 PNG，对照 QA 清单自评
# 4) 至少迭代一轮（改 JSON → 重渲染 → 再看）
# 5) 交付前对整批再跑一次：
node tools/validate-templates.mjs templates/<file1>.json templates/<file2>.json ...
```

- 渲染失败时读 CLI 报错（`layers[i]...` 精确到字段），改完重跑。
- 想看竖构图效果：`node tools/validate-templates.mjs <file> --photo templates/assets/test-photos/sample-portrait.jpg`。
- 想看深/浅不同底片效果：`--photo templates/assets/photos/architecture-2.jpg`。

**图层顺序**：所有层默认按 JSON 中**声明顺序**绘制（照片永远在最底）；v0.5 起可选 `z` 显式排序（小者在下，同 z 按声明顺序）。垫底色块/横条要声明在文字**之前**；压字装饰/细规线声明在文字**之后**；`attachTo` 图标自动最后绘制（不受 `z`/声明顺序影响）。

## 2. v0.5 新能力速查

> 引擎 v0.5 默认 cosmic-text 0.19 + swash 整形；字段取值/组合顺序以 `TEMPLATE-SPEC.md` §4.5e–§4.5k 为准。

**文本字效（`effects`，可组合；相对尺寸按 mask_unit = 首行基线换算）**

```jsonc
"effects": {
  "stroke": { "width": 0.02, "color": "#1A1A1A", "double": true, "gap": 0.02 },
  "relief": { "mode": "emboss", "depth": 0.06, "highlight": "#FFF7D6", "shadow": "#4A3200", "opacity": 0.7 },
  "fill":   { "mode": "foil", "colors": ["#8A6A1F", "#F6E27A", "#D4A017"], "angle": 100, "intensity": 0.9 },
  "shadow": { "offsetX": 0.01, "offsetY": 0.02, "blur": 0.01, "color": "#000000", "opacity": 0.5 },
  "case": "upper", "flipX": false, "flipY": false, "scaleX": 1.0
}
```

- 固定后处理顺序：外阴影 → 描边 → 凹刻/内阴影 → 填充 → 凸印（不得靠声明顺序改变）；勿堆叠超过 2–3 组，避免糊字。
- `fill.mode`：`gradient` / `foil`（≥2 色标）/ `texture`（`@builtin/...`、`assets/...`，缺失回退纸纹/底色）。

**自适应文本**：`width`（换行宽 0–1 画布宽）、`height`（目标块高 0–1，按比例缩字号）、`stretchWidth` / `stretchHeight`（左右锚点撑满至对侧 5% 边距）、`fillPage`（90% 画布内填满，优先于 stretch*）。

**群组**：`{"type":"group","id":"footer","anchor":"bottom-left","offset":{...},"width":0.5,"height":0.1,"opacity":0.9,"children":[1–32 个子层],"z":10}`。子层坐标相对群组盒；组内按声明顺序绘制；`attachTo` 只在同一作用域内定位（跨群组引用会跳过绘制）。

**日历**：`{"type":"calendar","id":"cal","anchor":"bottom-right","offset":{...},"size":0.28,"dateSource":"exif","year":2026,"month":9,"showLunar":true,"showWeekdays":true,"view":"month","color":"#1A1A1A","accent":"#E10600","fontFamily":["Inter"]}`。`view`: `month`（月网格）/ `day`（大日号）/ `strip`（单行）；阴历最多 1900–2100，无数据只显示公历（不造假）。

**层级**：所有层可选 `z`（小者先画，同 z 按声明顺序）；照片恒在最底；群组整体参与排序。

**形层新字段**：`double` + `gap`（双线）、`frame:"outer|opposite-h|opposite-v"` + `margin`（布局框）、`autoHide`（文本层 <2 时隐藏）、`span:"auto"`（分割线自动取宽）。

**校验 / 渲染（每个模板必跑）**：

```bash
node tools/validate-templates.mjs templates/<file>.json --photo templates/assets/test-photos/sample-landscape.jpg
```

- 竖构图换 `--photo templates/assets/test-photos/sample-portrait.jpg`；深底测 `--photo templates/assets/photos/architecture-2.jpg`。
- 不要用 `--legacy-text-renderer` 验收 v0.5 模板：该回退路径不渲染字效/日历，仅供回归对照。

## 3. 可用资产（不要发明新资产）

| 资产 | 路径 | 说明 |
|---|---|---|
| 品牌字标 | `@builtin/brand/{exif.brand_slug}` | 63 slug 自动解析；缺失留白属预期 |
| 镜头系列 | `@builtin/series/{exif.lens_series}` | sony-gm / canon-l / nikon-s / sigma-art / sigma-dgdn / hasselblad-xcd / fujifilm-xf |
| 机身/手机轮廓 | `@builtin/frame/camera-body`、`@builtin/frame/phone-frame` | 线稿，`tint:"auto"` 自适应黑/浅 |
| 胶片齿孔条 | `@builtin/frame/film-strip`（横）、`film-strip-v`（竖） | 齿孔透明，可放照片四边 |
| 胶片边码条 | `@builtin/frame/film-edge` | 抽象边码（无文字） |
| 条码 | `@builtin/frame/barcode` | 原创 EAN 风，用于票根 |
| 邮票卡 | `@builtin/frame/stamp-card` | 520×640 齿孔白卡（可直接当白框底） |
| 图标 | `@builtin/frame/icon-mountain / icon-camera / icon-drone / icon-lantern / icon-boat / icon-film / icon-pin` | 原创线性图标 |
| 印章 | `@builtin/frame/seal-red` | 朱红方印（自创纹样） |
| 游戏字标 | `@builtin/game/<slug>` | genshin/zzz/honkai/arknights/wwmeet/wukong（仅游戏分类，原创字标） |

- 所有 `@builtin/frame/*`、`@builtin/brand/*`、`@builtin/series/*`、`@builtin/game/*` 都有 `-light` 变体，图片层 `tint:"auto"` 会按背景自动选。
- 图形（线/框/圆点/菱形/六边形/色块）一律用 `shape` 层，不要造图片。

## 4. 可用字体（family 名不区分大小写）

`Inter`（UI/正文）、`JetBrains Mono`（参数/微字）、`Space Grotesk`（几何标题）、`Bebas Neue` / `Oswald`（大数字）、`Playfair Display` / `Cormorant Garamond`（衬线大标）、`Noto Sans SC` / `Noto Serif SC`（中文）、`Ma Shan Zheng`（中文书法）、`Great Vibes`（英文手写）。

## 5. 命名与元数据规范

- 文件名 = 模板 id：`<category>-<variant>.json`，`[a-z0-9-]`，全局唯一，如 `white-border-editorial-03.json`。
- `meta`：`name` 英文短名（2–4 词）、`nameI18n.zh` 中文名（有画面感，不要"模板1"）、`version:"1.0.0"`、`minEngineVersion:"0.5.0"`（用到 v0.5 新能力的模板必须；纯 v0.4 能力的模板可保留 `"0.4.0"`）、`author:"FrameGeist"`、`license:"CC0-1.0"`、`category` 必须与分配一致。
- 每个分类内**变体之间至少 2 处显著差异**（信息带位置/排版层级/配色/图形/背景类型），缩略图上必须一眼可区分。
- 一个模板内信息不重复；参数格式统一（推荐 `16mm · f/2.8 · 1/500s · ISO200` 或四列格）。

## 6. 分类气质速查

| 分类 | 气质关键词 | 典型结构（详见 DESIGN-LANGUAGE 原型） |
|---|---|---|
| white-border | 画册、留白、克制 | 白/奶油纸 + 底部信息带（左型号右参数）+ 细分隔线 |
| minimal | 极简、单行 | 细白边或无边框 + 一行参数（居中/角落） |
| classic-watermark | 官方水印、图库感 | 白/黑实底横条：品牌左、型号中、参数右 |
| borderless | 隐形、现场感 | 文字直接压照片，四角分工，auto 色 + 透明度 0.8± |
| personal | 个人署名、社交卡 | 头像位留白/名字 + 版权 + 社交平台字 |
| master | 大师、印章、仪式感 | 居中字标 + 手写印章 + 四列标注参数格 |
| camera | 机身、机械 | camera-body 轮廓 + 丝印信息 |
| phone | 手机影像、品牌感 | 厂商圆点/Apple 卡式两行机型 + 参数 |
| drone | 航拍、地理 | 无人机 + GPS 坐标 + 飞行参数（GPS 默认隐藏，设计要能空跑） |
| sports | 运动、海拔、路线 | 大图 + 中英地点 + `gps_alt` + 里程/速度感 |
| film | 胶片、暗房 | 齿孔边码 + 卷名 + 日期章（LED 橙红） |
| fuji | 富士配方卡 | 深/奶油参数面板 + 标注参数格（Film Simulation 等常量） |
| polaroid | 一次性成像、邮票 | stamp-card + 大数字日期 + 地点；或经典拍立得白框 |
| ticket | 票根、旅行 | barcode + 缺口感 + `TICKET/STATION` 微字 + 低饱和底 |
| calendar | 日历、大数字 | 大数字 + 中文日期/星期 + 月网格（小字） |
| magazine | 杂志封面、画廊海报 | 双线框/海报式大标 + 刊头 + 口号 + 段落 |
| colorwalk | 主色延伸 | `tint`/`blur` 底 + 日期 + 参数 |
| colorful | 彩色小色块 | 色块条 + 多彩点缀 + 日期/参数 |
| colorcard | 色卡 | `palette` 层（圆/方/菱形/六边形 + hex） |
| effect / blur-bg | 悬浮、投影、渐变 | 圆角 + 阴影 + blur 底 + 镜像/暗角 |
| portfolio | 作品集、展签 | 《标题》+ 作者/机型 + 竖排文字/侧注 |
| black-frame | 小黑框、正片 | 深色窄框 + 浅字 |
| festival | 节庆红金 | 红金 + 毛笔年份 + 印章 + 图标行（原创素材） |
| game | 游戏氛围 | 游戏字标 + 主题色形层；零官方素材；`notice` 必填 |

## 7. 红线（违反即返工）

1. 禁止访问/引用 frameelf 研究语料（临时目录）；禁止复刻其版式或照抄文案；一切自创。
2. 只用本文档列出的资产与字体；不新增文件、不改引擎代码、不动其他分类文件。
3. 模板必须过 `validate-templates.mjs`（等于引擎全量校验）且渲染 PNG 肉眼合格。
4. 表达式只用白名单文法；日期格式串内不要出现裸的大写 D/M/S/H 单词（除 token）。
5. GPS 相关设计必须以"GPS 被隐藏"为默认分支仍然完整（`fallback`），开启后才显示。
6. 中文文案用简体；避免政治/敏感/人物肖像内容。

## 8. 交付格式（最终消息）

- 输出文件清单（id + 路径）。
- 每个分类的变体差异一句话。
- 自评：逐条对照 DESIGN-LANGUAGE §7 QA 的结论 + 至少一轮迭代记录（改了什么、为什么）。
- `validate-templates.mjs` 最后一次运行汇总（N ok / 0 failed）。
