# FrameGeist v1.0.0 徽标官方核对对照表（47 项）

> - **契约依据**：`docs/V1.0.0-CONSTRAINTS.md` §3.3（47 项对照表）与 §4 Step 4（本表 → **STOP 2 用户审核** → 按审核结论批量落地）。
> - **只读审计**：本报告未修改 `web/brand/**`、`web/series/**`、`web/game/**`、`templates/**`、`crates/**`、`tools/**`；仅新增本文件。
> - **状态**：**待用户审核**（审核通过前不落地任何徽标变更）。
> - **日期**：2026-09-24；审计基线：manifest v4（`web/brand/index.json`，2026-09-21 生成）+ `tools/brand-colors.json` v1。

---

## 1. 范围、方法与证据

### 1.1 范围（47 项）

| 分组 | 项数 | 资产目录 | 变体矩阵 |
|---|---|---|---|
| camera | 18 | `web/brand/`（镜像 `templates/assets/brand/`） | 主 + `-mono` + `-light`（各含 96px `thumbs/`） |
| phone | 10 | `web/brand/`（同上） | 主 + `-mono` + `-light` |
| series | 13 | `web/series/`（镜像 `templates/assets/series/`） | 主 + `-light`（**无** `-mono`） |
| game | 6 | `web/game/`（镜像 `templates/assets/game/`） | 主 + `-light`（**无** `-mono`） |
| **合计** | **47** | | 512px 主档 + 96px 缩略图 |

颜色口径：`tools/brand-colors.json` 的 `icons[slug]`（Simple Icons 快照的 `hex`/`colorful`/`title`）+ `originalColorOverride`（当前仅 `canon: #C8102E`）；`colorful=false` 或无条目时主变体渲染为黑 `#000000`。

### 1.2 为什么 `lens`（28）不在本次 47 项内

- 契约 §3.3 明确只要求 **47 项**：相机 18 + 手机 10 + 镜头系列 13 + 游戏 6；`web/brand/index.json` 的 `lens` 组是「按镜头品牌维度」的另一份集合，不属于该 47 项清单。
- `lens`（28）中 **18 个 slug 与 camera 组完全相同**（blackmagicdesign、canon、dji、epson、fujifilm、hasselblad、insta360、leica、nikon、olympus、panasonic、pentax、phaseone、ricoh、sigma、sony、tamron、zeiss），它们共用同一份资产（`web/brand/<slug>.png`），本表结论对其同样适用（无需重复核对）。
- 其余 **10 个纯镜头品牌**（7artisans、laowa、meike、samyang、sirui、tokina、ttartisan、viltrox、voigtlander、yongnuo）不在契约清单内：其资产为 v0.9.0 起的原创排印（Geist/Instrument Serif 等 OFL 字体），本次不逐项展开，建议列入 v1.1 用同一模板补充核对（见 §5 待裁决第 12 条）。

### 1.3 证据与来源记号（本机实测，2026-09-24）

本机网络限制：`websearch` 不可用；`wikimedia.org`/`raw.githubusercontent.com` 不可达；部分官网被拦或超时（见附录 A）。因此来源列采用以下记号，**未核实的绝不冒充已核实**：

| 记号 | 含义 |
|---|---|
| `SI+` | 已实际抓取 Simple Icons CDN（`https://cdn.simpleicons.org/<slug>`）并核对（返回 SVG 的 `fill` = 该库锁定 hex；404 = 该库无此图标） |
| `SI-` | 仅 Simple Icons 快照记录（`tools/brand-colors.json` / `templates/assets/brand/CREDITS.json`），CDN 未逐项抓取 |
| `O+` | 官网首页本机可达（HTTP HEAD 200，**未抓取正文**；官方徽标形态以人工截图为准） |
| `O-` | 官网本机不可达（403/超时） |
| `待核实` | 无本机可验证来源；「官方样式参考」按既有知识填写，落地前需用户以官网/官微截图确认 |

### 1.4 本地资产抽查证据

- **像素采样**（512px 主档，64×64 网格，非透明像素主色）：canon `#C8102E`、nikon `#FFE100`、sony `#000000`、fujifilm `#FB0020`、leica `#E20612`、epson `#003399`、panasonic `#0049AB`、dji `#000000`、blackmagicdesign `#FFA200`、insta360 `#FFEE00`、apple `#000000`、google `#4285F4`、honor `#000000`、huawei `#FF0000`、motorola `#E1140A`、nokia `#005AFF`、oneplus `#F5010C`、oppo `#2D683D`、samsung `#1428A0`、vivo `#415FFF`；9 个原创相机字标（canon 除外）主色均为 `#000000`。
- **Simple Icons 成员核验**：canon、hasselblad、zeiss、sigma、olympus、pentax、ricoh、phaseone、tamron → **404（不在库中）**；fujifilm、sony、leica、nokia、motorola、blackmagicdesign、insta360 → **在库**（hex 见各行）。
- **目视核对**（代表性 20+ 张 PNG）：确认 canon 为红色衬线字标、leica 为红点手写体徽标、samsung/nokia/oppo/vivo/honor/epson/panasonic/fujifilm 为字标、apple/huawei/motorola/google 为图形标、dji/blackmagicdesign/insta360 为官方图形、series/game 均为原创排印。
- **官网抓取**：canon.com ✅（首页导航含官方「Canon Logo」页 `/en/corporate/logo/`，该子页本机 404，待核实）；leica-camera.com ✅（页头 `logo.svg`，alt「Leica logo - Home」）。

### 1.5 审计中发现的「标签 vs 画面」不一致（3 处）

| slug | manifest 显示名 | 画面实际文字 | 结论 |
|---|---|---|---|
| olympus | OM System | OLYMPUS | 品牌名与画面不符（见 §3.1 第 10 行） |
| panasonic | Lumix | Panasonic | 品牌名与画面不符（见 §3.1 第 11 行） |
| wwmeet | WWMEET | 燕云十六声 | 显示名与画面不符（见 §3.4 第 46 行） |

---

## 2. 结论摘要

| 分类 | 项数 | 说明 |
|---|---|---|
| **保留不动** | **22** | 形状与颜色已符合既定口径（其中 4 项「颜色/形态口径待裁决」，见 §5 第 1、2 条） |
| **仅颜色** | **6** | ricoh、zeiss（缺官方色）、canon-l（缺 Canon 红）、fujifilm、huawei、motorola（颜色口径待核实） |
| **字形重排** | **19** | 7 个相机品牌字标 + 7 个系列徽章 + 5 个游戏字标（用 OFL 字体按官方排印风格重排，**不复制官方矢量/插画**） |
| **需官微/官网截图才能定案** | **24** | 19 个字形重排 + 5 个颜色待核实项（与上表有交集，单列口径） |

另有 4 项「口径待裁决」（nikon 黄 vs 黑、insta360 黄 vs 黑、blackmagicdesign 图形 vs 字标、google 单色 G 是否接受），它们本身无技术差异，但决定权在用户。

---

## 3. 对照表（47 项）

### 3.1 camera（18 项）

| slug | 分组 | 显示名 | 官方样式参考 | 来源 | 当前实现 | 差异 | 拟改动作 | 素材许可 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| blackmagicdesign | camera | Blackmagic | 官方为「Blackmagic Design」字标 + 三叠圆角方块图形标（品牌橙系，官网常见白字黑底） | `SI+`（`fill #FFA200`）；`O+` blackmagicdesign.com | Simple Icons 三叠方块图形，橙 `#FFA200`，512×512；像素采样一致 | 图形标与 Simple Icons 路径一致；官方主用字标（当前无字标变体）；橙色是否为官方主色待核实 | 保留图形标；如需更贴官网可增补「BLACKMAGIC DESIGN」排印字标（Geist 700、字距 +6） | Simple Icons（CC0-1.0） | 商标；橙对白底对比度 ≈2.0:1（浅底应改用 `-mono`） |
| canon | camera | Canon | 红色衬线字标「Canon」（1956 年至今的官方字标）；官方红 Pantone 186 C ≈ `#C8102E` | `O+` canon.com（已抓取；首页含官方「Canon Logo」页链接，子页 404 待核实）；`SI+` canon → 404 | 原创排印字标 Noto Serif SC 700（字距 -2），红 `#C8102E`（`originalColorOverride`），697×512；像素采样 `#C8102E` | 颜色已对齐；字形为近似衬线（官方为定制字标，C/a/n 弧线与衬线细节不同） | 颜色保留；字形保留原创重绘（**不复制官方矢量**）；如需更贴近可比较 Noto Serif Display / Playfair Display 700 样张（待官微截图） | 原创重绘（OFL 字体）+ 公开色值（Pantone 186 C） | 商标；大尺寸下字形与官方可辨差异 |
| dji | camera | DJI | 黑色风格化「dji」连写字标（官方标识即该字形） | `SI-`（`#000000`/非彩色）；`O+` dji.com | Simple Icons dji 字标，黑 `#000000`，512×512；像素采样一致 | 与官方形制基本一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| epson | camera | Epson | 蓝色无衬线字标「EPSON」，官方蓝 `#003399` | `SI-`（`#003399`/彩色）；`O+` epson.com | Simple Icons 字标，蓝 `#003399`，512×512；像素采样一致 | 无明显差异 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| fujifilm | camera | Fujifilm | 「FUJIFILM」无衬线字标；Simple Icons 锁定红 `#FB0020`；官方企业识别常见黑/绿用法（**待核实**） | `SI+`（`fill #FB0020`）；`O+` fujifilm.com | Simple Icons 字标，红 `#FB0020`，512×512；像素采样一致 | 字标形态一致；颜色与「官方黑字标/品牌绿」的常见印象不一致，需确认以 SI 为准还是以官网为准 | 仅颜色（待核实后二选一：保留 SI 红 / 改官方色）；形状保留 | Simple Icons（CC0-1.0）；色值以 SI 元数据 | 商标；颜色口径若与官方不符会被判「不符合官方设计」 |
| hasselblad | camera | Hasselblad | 全大写无衬线字标「HASSELBLAD」（宽字距、偏几何；另有 H 徽记，待核实） | `SI+` hasselblad → 404；`O+` hasselblad.com（未抓正文）→ **待核实** | 原创排印 Instrument Sans 600（字距 +4），黑，1413×512 | 非官方字形；字重/字距为近似 | 字形重排（候选：Instrument Sans 500 字距 +8 或 Inter 500 字距 +10）；需官微截图定案 | 原创重绘（OFL 字体） | 商标；官方字标辨识度高，差异易被察觉 |
| insta360 | camera | Insta360 | 黄色圆形漩涡图形标（Simple Icons）；官方另有「Insta360」字标，常用黑/白底黄点缀 | `SI+`（`fill #FFEE00`）；`O+` insta360.com | Simple Icons 漩涡图形，黄 `#FFEE00`，512×512；像素采样一致 | 形态一致；纯黄在浅色背景几乎不可见 | 保留不动（形状）；浅底场景强制 `-mono` 或在模板侧改用黑/白变体 | Simple Icons（CC0-1.0） | 商标；对比度 ≈1.2:1（可达性） |
| leica | camera | Leica | 红点 + 白色手写体「Leica」（官方标志性红点徽标）；SI 锁定红 `#E20612` | `SI+`（`fill #E20612`）；`O+` leica-camera.com（已抓取；页头 `logo.svg`，alt「Leica logo - Home」） | Simple Icons 红点徽标，红 `#E20612`，512×512；像素采样一致 | 与官方形制一致；官方红精确 Pantone 值待核实 | 保留不动 | Simple Icons（CC0-1.0） | 商标；官方对红点使用较严格（识别用途 + 免责声明） |
| nikon | camera | Nikon | 无衬线字标（官方通常黑色），品牌黄 `#FFE100`（SI 锁定） | `SI-`（`#FFE100`/彩色）；`O-` nikon.com 本机超时（HEAD 实测 200 但正文抓取超时）→ 部分待核实 | Simple Icons 字标，黄 `#FFE100`，512×512；像素采样一致 | 字标形态一致；纯黄字标在浅底可见性差；官方多为黑字标 + 黄点缀 | 保留不动（形状）；浅底强制 `-mono`；是否改用官方黑字标由用户裁决（§5 第 1 条） | Simple Icons（CC0-1.0） | 商标；对比度 ≈1.3:1（可达性） |
| olympus | camera | OM System | 2021 年起品牌为「OM SYSTEM」（字标 + OM 徽记）；相机 EXIF Make 仍为 OLYMPUS | `SI+` olympus → 404；`O+` omsystem.com（跳转 om-digitalsolutions.cn）→ 样式**待核实** | 原创排印「OLYMPUS」Inter 500（字距 +10），黑，1043×512 | **画面文字（OLYMPUS）与显示名（OM System）不一致**；通用无衬线 vs 官方字标 | 字形重排：改为「OM SYSTEM」原创排印（候选 Inter 600 或 Instrument Sans 600，字距 +6~+10）；slug 不变（EXIF 兼容）；需官微截图 | 原创重绘（OFL 字体） | 商标；改名影响旧机型用户识别（slug 不变，仅画面文字） |
| panasonic | camera | Lumix | 相机品牌为「LUMIX」独立字标；`#0049AB` 为母品牌 Panasonic 蓝 | `SI-`（panasonic `#0049AB`）；`O+` lumix.com（未抓正文）→ LUMIX 官方色**待核实** | Simple Icons「Panasonic」字标，蓝 `#0049AB`，512×512；像素采样一致 | **画面文字（Panasonic）与显示名（Lumix）不一致**；官方 LUMIX 为另一套字形 | 字形重排：改为「LUMIX」原创排印（候选 Geist 700 或 Inter 700，字距 +6）；颜色保留 `#0049AB` 或按 LUMIX 官方色（待核实）；需官微截图 | 原创重绘（OFL 字体） | 商标；显示名与画面不一致会直接影响用户判断 |
| pentax | camera | Pentax | 无衬线字标「PENTAX」（定制无衬线，待核实） | `SI+` pentax → 404；`O+` ricoh.com（母集团，未抓正文）→ **待核实** | 原创排印 Space Grotesk 600（字距 +8），黑，888×512 | 字形近似但非官方；官方字重/字距待核实 | 字形重排（候选 Inter 600 字距 +10 或 Space Grotesk 500）；需官微截图 | 原创重绘（OFL 字体） | 商标 |
| phaseone | camera | Phase One | 无衬线字标「PHASE ONE」（官方偏细/几何，待核实） | `SI+` phaseone → 404；`O+` phaseone.com（未抓正文）→ **待核实** | 原创排印 Geist 600（字距 +8），黑，1312×512 | 字重可能偏粗；官方字距待核实 | 字形重排（候选 Geist 400/500 或 Inter 400，字距 +10）；需官微截图 | 原创重绘（OFL 字体） | 商标 |
| ricoh | camera | Ricoh | 红色字标「RICOH」（Ricoh 红，精确 hex **待核实**） | `SI+` ricoh → 404；`O+` ricoh.com（未抓正文）→ **待核实** | 原创排印 Inter 700（字距 +6），黑，737×512 | **颜色缺失**（黑 vs 官方红）；字形近似 | 仅颜色：加入 `originalColorOverride`（色值需官网/官方物料取色，**不臆造**）；字形可保留 | 原创重绘（OFL 字体）+ 官方色值待核实 | 商标；色值不能猜（否则门禁断言会把错误固化） |
| sigma | camera | Sigma | 无衬线字标「SIGMA」（定制无衬线、字距较宽，待核实） | `SI+` sigma → 404；`O+` sigma-global.com（未抓正文）→ **待核实** | 原创排印 Space Grotesk 700（字距 +8），黑，747×512 | 字形近似；官方字重/字距待核实 | 字形重排（候选 Space Grotesk 500 或 Inter 500，字距 +12）；需官微截图 | 原创重绘（OFL 字体） | 商标 |
| sony | camera | Sony | 衬线字标「SONY」（官方定制衬线，黑白为主） | `SI+`（`fill #FFFFFF`，即 SONY 字标路径） | Simple Icons 字标，按规则渲染黑 `#000000`，512×512；像素采样一致 | 与官方形制一致（SI 路径即 SONY 字标） | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| tamron | camera | Tamron | 无衬线字标「TAMRON」（定制无衬线、粗体，待核实） | `SI+` tamron → 404；`O+` tamron.com（未抓正文）→ **待核实** | 原创排印 Space Grotesk 700（字距 +6），黑，876×512 | 近似；官方字形待核实 | 字形重排（候选 Inter 700 字距 +8）；需官微截图 | 原创重绘（OFL 字体） | 商标 |
| zeiss | camera | Zeiss | 蓝色字标「ZEISS」（官方蓝，精确 hex **待核实**）+ 定制无衬线 | `SI+` zeiss → 404；`O+` zeiss.com（未抓正文）→ **待核实** | 原创排印 Inter 400（字距 +14），黑，777×512 | **颜色缺失**（黑 vs 官方蓝）；字重/字距为近似 | 仅颜色（加入官方蓝，取色待核实）+ 字形微调；形状保留 | 原创重绘（OFL 字体）+ 官方色值待核实 | 商标；色值待核实 |

### 3.2 phone（10 项）

| slug | 分组 | 显示名 | 官方样式参考 | 来源 | 当前实现 | 差异 | 拟改动作 | 素材许可 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| apple | phone | Apple | 黑色苹果图形标（官方 glyph） | `SI-`（`#000000`）；`O+` apple.com | Simple Icons 苹果图形，黑，512×512；像素采样一致 | 与官方形制一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标（Apple 标识管控最严；仅器材识别用途 + 免责声明） |
| google | phone | Google | 四色「G」图形标（蓝/红/黄/绿） | `SI-`（`#4285F4`）；`O-` about.google 超时 | Simple Icons 单色「G」，蓝 `#4285F4`，512×512；像素采样一致 | 官方为四色，当前单色（按契约红线不复制官方多色插画） | 保留不动（单色化口径）；是否接受单色 G 见 §5 第 2 条 | Simple Icons（CC0-1.0） | 商标；单色 G 仍强识别为 Google（观感可接受） |
| honor | phone | HONOR | 全大写无衬线字标「HONOR」（官方黑/白为主） | `SI-`（`#000000`）；`O+` hihonor.com | Simple Icons 字标，黑，512×512；像素采样一致 | 与官方形制基本一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| huawei | phone | Huawei | 红色花瓣图形标 +「HUAWEI」字标；官方红（SI `#FF0000`，官方 Pantone **待核实**） | `SI-`（`#FF0000`）；`O+` huawei.com（未抓正文）→ **待核实** | Simple Icons 花瓣图形，红 `#FF0000`，512×512；像素采样一致 | 图形一致；纯红 `#FF0000` 与官方红（常见深红系）可能有偏差；无字标 | 仅颜色（待官网色值确认后微调）；形状保留 | Simple Icons（CC0-1.0）+ 官方色值待核实 | 商标；对比度 ≈4.0:1 |
| motorola | phone | Motorola | 双翼「M」图形（常见黑色单色；红色圆底为官方变体之一，**待核实**） | `SI+`（`fill #E1140A`，圆 + 双翼路径）；`O+` motorola.com（跳转联想商城） | Simple Icons 红圆 + 白 M，红 `#E1140A`，512×512；像素采样一致 | 官方更常用黑/白单色 M；红圆是否为当前官方主用形待核实 | 仅颜色（若以官网为准需改黑，待核实）；形状保留 | Simple Icons（CC0-1.0） | 商标 |
| nokia | phone | Nokia | 2023 新版几何字标「NOKIA」，官方蓝 `#005AFF` | `SI+`（`fill #005AFF`）；`O+` nokia.com | Simple Icons 字标，蓝 `#005AFF`，512×512；像素采样一致 | 与官方新版形制一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| oneplus | phone | OnePlus | 红色「1+」方框图形标，官方红 `#F5010C` | `SI-`（`#F5010C`）；`O+` oneplus.com | Simple Icons「1+」方框，红 `#F5010C`，512×512；像素采样一致 | 与官方形制一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标；对比度 ≈4.3:1 |
| oppo | phone | OPPO | 绿色小写无衬线字标「oppo」，官方绿 `#2D683D`（SI 锁定） | `SI-`（`#2D683D`）；`O+` oppo.com | Simple Icons 字标，绿 `#2D683D`，512×512；像素采样一致 | 与官方形制一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| samsung | phone | Samsung | 蓝色字标「SAMSUNG」，官方蓝 `#1428A0` | `SI-`（`#1428A0`）；`O-` samsung.com 403 | Simple Icons 字标，蓝 `#1428A0`，512×512；像素采样一致 | 与官方形制一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |
| vivo | phone | vivo | 蓝色小写字标「vivo」，官方蓝 `#415FFF` | `SI-`（`#415FFF`）；`O+` vivo.com | Simple Icons 字标，蓝 `#415FFF`，512×512；像素采样一致 | 与官方形制一致 | 保留不动 | Simple Icons（CC0-1.0） | 商标 |

### 3.3 series（13 项）

> 本组全部为**原创排印**（非官方素材，Simple Icons 无对应图标）；主变体黑、`-light` 白。官方「系列徽章」多为专用图形/点缀色，重排只做排印贴近，**不复制官方徽记矢量**。

| slug | 分组 | 显示名 | 官方样式参考 | 来源 | 当前实现 | 差异 | 拟改动作 | 素材许可 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| sony-gm | series | GM | G Master 徽章为专用「G」标记（黑/银底 + 红或金点缀），非纯文字排印 | `SI+` 无系列图标；`O-` sony.com 403 → **待核实** | 原创排印 Geist 700「GM」（字距 +2），黑，311×512 | 官方为专用徽记；当前为通用无衬线文字，无点缀色 | 字形重排（字距 +4 粗无衬线；是否引入官方点缀色由用户裁决，§5 第 5 条）；需官微截图 | 原创重绘（OFL 字体） | 商标；系列徽章识别度依赖专用形制 |
| sony-g | series | G | G 系列专用「G」标记（与 GM 同源风格） | `O-` sony.com 403 → **待核实** | 原创排印 Geist 600「G」，黑，173×512 | 通用字形 vs 专用标记 | 字形重排（待官微截图）；或保留 | 原创重绘（OFL 字体） | 商标 |
| canon-l | series | L | L 系列以红圈（红环）为核心识别，「L」常以红色呈现 | `O+` canon.com（已抓取；官方 Logo 子页 404）→ 字体待核实 | 原创排印 Instrument Serif 400「L」，黑，173×512 | **颜色缺失**（黑 vs 红）；字形为通用衬线 | 仅颜色：改 Canon 红 `#C8102E`（与 `brand/canon` 同源）；字形保留 | 原创重绘（OFL 字体）+ 公开色值 | 商标；红色 L 与官方 L 系列联想强，需确认可接受 |
| canon-rf-l | series | RF L | RF 卡口 + L 系列；官方「RF」为专用字形（机身/镜头卡口标识） | `O+` canon.com（未抓子页）→ **待核实** | 原创排印 Geist 600「RF L」（字距 +4），黑，589×512 | 官方 RF 字形不同；「RF L」并非官方组合字样 | 字形重排（候选「RF」与「L」分离排印；或只保留 L）；需官微截图/用户裁决（§5 第 6 条） | 原创重绘（OFL 字体） | 商标；组合字样可能引起混淆 |
| nikon-s | series | S | Z 卡口 S-Line 专用「S」标记（待核实） | `O-` nikon.com 抓取超时 → **待核实** | 原创排印 Geist 700「S」，黑，173×512 | 通用字形 vs 专用标记 | 字形重排（待官微截图）；或保留 | 原创重绘（OFL 字体） | 商标 |
| sigma-art | series | ART | Art 产品线专用标记（Sigma 三线之一，常配「A」形符号） | `SI+` 无系列图标；`O+` sigma-global.com（未抓正文）→ **待核实** | 原创排印 Geist 700「ART」（字距 +6），黑，458×512 | 通用字形 vs 官方线标 | 字形重排（待官微截图） | 原创重绘（OFL 字体） | 商标 |
| sigma-dgdn | series | DG DN | DG DN 为镜头卡口/像场规格刻字（非独立徽标） | `O+` sigma-global.com（未抓正文）→ **待核实** | 原创排印 Geist 500「DG DN」（字距 +4），黑，727×512 | 作为技术规格字样，当前排印可接受 | 保留不动（必要时字距微调） | 原创重绘（OFL 字体） | 商标（低） |
| sigma-apo | series | APO | APO 为复消色差镜片技术标记（镜头刻字） | `O+` sigma-global.com（未抓正文）→ **待核实** | 原创排印 Geist 600「APO」（字距 +8），黑，464×512 | 技术标记，可接受 | 保留不动 | 原创重绘（OFL 字体） | 商标（低） |
| hasselblad-xcd | series | XCD | XCD 为哈苏中画幅镜系名（镜头刻字） | `O+` hasselblad.com（未抓正文）→ **待核实** | 原创排印 Geist 600「XCD」（字距 +6），黑，458×512 | 镜系名，可接受 | 保留不动 | 原创重绘（OFL 字体） | 商标（低） |
| fujifilm-xf | series | XF | XF 为富士 X 卡口镜系名 | `O+` fujifilm.com（未抓正文）→ **待核实** | 原创排印 Geist 700「XF」（字距 +4），黑，315×512 | 镜系名，可接受 | 保留不动 | 原创重绘（OFL 字体） | 商标（低） |
| zeiss-batis | series | BATIS | BATIS 为蔡司镜头线名（官方字标，待核实） | `SI+` 无系列图标；`O+` zeiss.com（未抓正文）→ **待核实** | 原创排印 Geist 500「BATIS」（字距 +8），黑，747×512 | 通用字形 vs 官方线标 | 字形重排（候选 Inter 500/600 字距 +10；是否引入官方蓝待裁决）；需官微截图 | 原创重绘（OFL 字体） | 商标 |
| leica-apo | series | APO | APO 为徕卡镜头技术标记（APO-Summicron 等命名的一部分） | `O+` leica-camera.com（已抓取，未见系列徽标页）→ **待核实** | 原创排印 Instrument Serif 400「APO」（字距 +8），黑，464×512 | 技术标记；衬线方向与徕卡字标风格接近 | 保留不动 | 原创重绘（OFL 字体） | 商标（低） |
| tamron-sp | series | SP | SP（Super Performance）为腾龙高端线名（官方线标，待核实） | `SI+` 无系列图标；`O+` tamron.com（未抓正文）→ **待核实** | 原创排印 Geist 700「SP」（字距 +4），黑，315×512 | 通用字形 vs 官方线标 | 字形重排（待官微截图）；或保留 | 原创重绘（OFL 字体） | 商标 |

### 3.4 game（6 项）

> 本组全部为**原创文字渲染**（非官方素材）；游戏 IP 对标识管控严格，本表口径为「只做排印风格贴近」，不复制官方书法/多色插画。

| slug | 分组 | 显示名 | 官方样式参考 | 来源 | 当前实现 | 差异 | 拟改动作 | 素材许可 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| genshin | game | GENSHIN | 「原神」中文书法标 +「GENSHIN IMPACT」定制衬线英文标（多色插画/金红配色） | `O+` mihoyo.com（未抓正文）→ 官方标样式**待核实** | 原创排印 Cormorant Garamond 700「GENSHIN」（字距 +8），黑，1029×512 | 西文衬线风格与官方英文标（定制衬线 + 装饰）不同；无中文「原神」 | 字形重排（保留衬线方向、字距 +10；是否加中文行待用户裁决，§5 第 7 条）；不复制官方书法/插画 | 原创重绘（OFL 字体） | 商标/著作权（游戏 IP 管控严，使用范围需谨慎） |
| zzz | game | ZZZ | 「绝区零 / Zenless Zone Zero」定制棱角/潮流字体标（黄黑） | 官方站点未实测 → **待核实** | 原创排印 Unbounded 700「ZZZ」（字距 +10），黑，470×512 | Unbounded 为几何显示体，接近但不等于官方棱角字形；无黄色点缀 | 字形重排（保留 Unbounded 或换更棱角字体；字距 +12）；需官微截图 | 原创重绘（OFL 字体） | 商标/著作权 |
| honkai | game | HONKAI | 「崩坏」系列定制字标（中英；星穹铁道/三消等多作各异） | `O+` mihoyo.com（未抓正文）→ **待核实** | 原创排印 Geist 600「HONKAI」（字距 +8），黑，888×512 | 通用无衬线 vs 官方定制字标 | 字形重排（待官微截图）；或保留 | 原创重绘（OFL 字体） | 商标/著作权 |
| arknights | game | ARKNIGHTS | 「ARKNIGHTS」定制无衬线字标（黑白/工业风） | `O+` ak.hypergryph.com（未抓正文）→ **待核实** | 原创排印 Oswald 600「ARKNIGHTS」（字距 +6），黑，1294×512 | Oswald 为窄体；官方字标字宽/字重待核实 | 字形重排（候选 Inter 700 字距 +8 或保留 Oswald）；需官微截图 | 原创重绘（OFL 字体） | 商标/著作权 |
| wwmeet | game | WWMEET | 「燕云十六声」书法（毛笔）字标 | `O+` wherewindsmeetgame.com（未抓正文）→ **待核实** | 原创排印 Ma Shan Zheng 400「燕云十六声」（毛笔风 CJK），黑，1714×512 | 方向接近（毛笔书法风）；具体字形与官方书法不同；**显示名「WWMEET」与画面中文不一致** | 保留不动（字体方向正确）；显示名建议改为「燕云十六声」（manifest label 修正，属落地批次）；需官微截图 | 原创重绘（OFL 字体） | 商标/著作权；中文显示名在英文 locale 下的可用性 |
| wukong | game | WUKONG | 「黑神话：悟空」中文书法标 +「BLACK MYTH WUKONG」定制衬线/篆刻风英文标 | `O-` heishenhua.com HEAD 404 → **待核实** | 原创排印 Oswald 700「WUKONG」（字距 +10），黑，900×512 | 窄体无衬线 vs 官方衬线/书法风；无中文 | 字形重排（候选 Noto Serif SC 700 或 Ma Shan Zheng 中文行 + 衬线英文）；需官微截图 | 原创重绘（OFL 字体） | 商标/著作权（黑神话 IP 管控严） |

---

## 4. 总结与批量落地建议

### 4.1 分类统计（47 项）

| 分类 | 数量 | 明细 |
|---|---|---|
| 保留不动 | 22 | camera 8（blackmagicdesign、canon、dji、epson、insta360、leica、nikon、sony）；phone 8（apple、google、honor、nokia、oneplus、oppo、samsung、vivo）；series 5（sigma-dgdn、sigma-apo、hasselblad-xcd、fujifilm-xf、leica-apo）；game 1（wwmeet） |
| 仅颜色 | 6 | camera 3（fujifilm、ricoh、zeiss）；phone 2（huawei、motorola）；series 1（canon-l） |
| 字形重排 | 19 | camera 7（hasselblad、olympus、panasonic、pentax、phaseone、sigma、tamron）；series 7（sony-gm、sony-g、canon-rf-l、nikon-s、sigma-art、zeiss-batis、tamron-sp）；game 5（genshin、zzz、honkai、arknights、wukong） |
| 其中需官微/官网截图才能定案 | 24 | 19 个字形重排 + 5 个颜色待核实（fujifilm、ricoh、zeiss、huawei、motorola） |

### 4.2 批量落地建议顺序（审核通过后）

1. **第一批 · 仅颜色（零字形风险）**：`canon-l` → Canon 红 `#C8102E`（色值已定）；`ricoh`、`zeiss` 官方色值确认后加入 `tools/brand-colors.json` 的 `originalColorOverride`（**取色未确认前不落地**）；`fujifilm`、`huawei`、`motorola` 按用户裁决的二选一执行。同步 `brand-colors.json` 版本递增、`web/brand/index.json` manifest v5、`check-brand-colors` 扩展为「三组去重全部品牌 + 官方色覆盖 + 每品牌主色断言」。
2. **第二批 · 字标文本修正（影响识别正确性）**：`olympus` → OM SYSTEM、`panasonic` → LUMIX、`wwmeet` 显示名 → 燕云十六声；三处「标签 vs 画面」不一致一并消除。
3. **第三批 · 相机字标排印重排（低风险）**：pentax、sigma、tamron、phaseone、hasselblad（+ 可选 ricoh/zeiss 字形）；用现有 OFL 字体 + 字距参数出 **2–3 个候选样张**供用户挑选，再全量生成。
4. **第四批 · 系列徽章（13）**：先落地 canon-l（红）与 5 个技术刻字（保留不动）；其余 7 项按官微截图定字体；「是否引入官方点缀色」按 §5 第 5 条裁决执行。
5. **第五批 · 游戏字标（6）**：wwmeet 保留 + 显示名修正；其余 5 项待官微截图后仅做排印贴近（不复制官方书法/插画）。
6. **收尾门禁**：重生成 512px + 96px 全量资产 → 像素/色值断言（每品牌主色）→ 关键品牌字形轮廓抽检 → `check-brand-colors` 全绿 → CREDITS/商标免责声明同步 → 样片/基线/对比图按契约 §5 走。

### 4.3 落地时的技术要点（只读审计建议）

- 颜色改动全部走 `tools/brand-colors.json` 的 `originalColorOverride` / `icons` 快照机制（与 canon 同路径），不改生成器逻辑；`colorful` 规则保持。
- 字标重排只改 `tools/gen-brand-assets.mjs` 的 `WORDMARKS` / `SERIES` / `GAMES` 参数（字体、字重、字距），不改资产矩阵与路径（兼容既有模板引用）。
- 系列/游戏目前只有黑/白两变体；若引入官方点缀色需新增变体维度，属资产矩阵变更，须在审核时一并确认（影响 `templates/` 引用与门禁）。

---

## 附录 A：官网可达性实测（HTTP HEAD，2026-09-24）

| 域名 | 结果 | 域名 | 结果 |
|---|---|---|---|
| blackmagicdesign.com | 200 | hihonor.com | 200 |
| canon.com | 200（已抓取） | huawei.com | 200 |
| dji.com | 200 | motorola.com | 200（跳转联想商城） |
| epson.com | 200 | nokia.com | 200 |
| fujifilm.com | 200 | oneplus.com | 200 |
| hasselblad.com | 200 | oppo.com | 200 |
| insta360.com | 200 | vivo.com | 200 |
| leica-camera.com | 200（已抓取） | phaseone.com | 200 |
| nikon.com | 200（正文抓取超时） | lumix.com | 200 |
| omsystem.com | 200（跳转 om-digitalsolutions.cn） | mihoyo.com | 200 |
| ricoh.com | 200 | ak.hypergryph.com | 200 |
| sigma-global.com | 200 | wherewindsmeetgame.com | 200 |
| sony.com | 403 | heishenhua.com | 404（HEAD） |
| tamron.com | 200 | about.google | 超时 |
| zeiss.com | 200 | panasonic.com / samsung.com | 403 |

> 注：`O+` 仅代表首页可达；除 canon.com / leica-camera.com 外均**未抓取正文**，官方徽标形态以人工截图核对为准。

## 附录 B：Simple Icons 成员核验结果

- **在库（19，`official: true`）**：sony、nikon、fujifilm、leica、panasonic、dji、apple、epson、insta360、samsung、vivo、oppo、oneplus、huawei、honor、google、motorola、nokia、blackmagicdesign。
- **不在库（本次实测 404）**：canon、hasselblad、zeiss、sigma、olympus、pentax、ricoh、phaseone、tamron（+ 本次未逐项抓取但快照标记为非官方的：gopro、sandisk、profoto、smallrig 等，不在 47 项内）。
- **series / game 全部不在 Simple Icons**，为 FrameGeist 原创排印。

---

## 5. 待用户裁决的问题

1. **颜色口径**：以 Simple Icons 元数据为准（当前实现）还是以官网/官方物料为准？涉及 **nikon**（黄 `#FFE100` vs 官方黑字标）、**insta360**（黄 `#FFEE00` vs 黑/白）、**fujifilm**（红 `#FB0020` vs 黑/绿）、**huawei**（`#FF0000` vs 官方红）、**motorola**（红圆 vs 黑 M）、**blackmagicdesign**（橙 `#FFA200` vs 黑白字标）。
2. **哪些品牌必须用官方字标/图形形态**（而非 Simple Icons 单色字形或原创排印）？特别是 apple/google/huawei/motorola；是否接受 **google 单色 G**（官方为四色，红线禁止复制多色插画）。
3. **手机品牌中文名排版**：oppo/vivo/honor/huawei 是否需要在中文 locale 增补中文名（如「华为」「荣耀」）？还是保持英文标识？
4. **olympus → OM SYSTEM、panasonic → LUMIX** 的画面文字替换是否可接受（slug 不变，EXIF 兼容）？旧机型用户是否更希望保留 OLYMPUS/Panasonic 字样？
5. **系列徽章是否引入官方点缀色**（红/金/蓝），还是维持当前黑白两变体？涉及 sony-gm、sony-g、canon-l、nikon-s、sigma-art、zeiss-batis 等。
6. **「RF L」组合字样**是否保留，还是拆分排印或只保留 L？
7. **游戏字标口径**：是否接受「仅排印贴近、不复制官方书法/插画」？是否加入中文行（原神/绝区零/崩坏/明日方舟/燕云十六声/黑神话：悟空）？
8. **官微截图交付清单**：建议优先提供 hasselblad、olympus、panasonic、pentax、phaseone、sigma、tamron、zeiss、ricoh 及 7 个系列徽章 + 5 个游戏字标（共 21 项）；截图请尽量含字标正面、字距、颜色与点缀元素。
9. **ricoh / zeiss 官方色 hex**：由用户提供官方色值，或授权按官网取色（避免臆造色值被门禁固化）。
10. **可达性处理**：nikon/insta360 黄色对白底对比度仅 ≈1.2–1.3:1；是否在浅色模板强制使用 `-mono` 黑变体？
11. **商标免责声明**：是否需要在 CREDITS/免责声明中补充游戏 IP 的专门说明？
12. **lens 组 10 个纯镜头品牌**（7artisans、laowa、meike、samyang、sirui、tokina、ttartisan、viltrox、voigtlander、yongnuo）是否列入 v1.1 补充核对（本次按契约排除）？

## 6. 裁决记录（2026-09-24，用户逐条裁决）

1. **颜色口径**：维持 Simple Icons 元数据（nikon `#FFE100`、insta360 `#FFEE00`、fujifilm `#FB0020`、huawei `#FF0000`、motorola 红圆、blackmagicdesign `#FFA200` 全部不改）→「仅颜色」类改动作废。
2. **徽标形态**：使用**官方标识**（用户声明已获授权；官方素材由用户提供）→ 原「只随包 CC0/PD」红线放宽为「官方资产经授权可用」。
3. **中文名**：仅界面显示名加中文（zh-CN/zh-TW 显示「华为」「荣耀」等），徽标画面保持官方拉丁字标。
4. **旧品牌名**：保留 OLYMPUS / Panasonic（画面文字不改）。
5. **系列点缀色**：13 个系列徽章全部引入官方点缀色变体（资产矩阵扩大 + manifest v5 + 模板引用与 `check-brand-colors` 同步）。
6. **RF L**：只保留 **L**（配官方红点缀色，去掉「RF」前缀）。
7. **游戏字标**：官方标识优先 + 排印兜底（有官方素材用官方；其余按官方排印风格原创重排，不复制书法/插画）；中文界面可加中文行。
8. **官方素材交付**：一次性提供 21 项（相机字标 9 + 系列徽章 7 + 游戏字标 5），交付目录 `brand-official-inbox/`（已 gitignore），按 slug 命名，PNG 透明底 ≥1000px / SVG / 高清截图。
9. **ricoh / zeiss 官方色**：授权按官网取色并记录来源，写入 `tools/brand-colors.json`。
10. **浅底黄色徽标**：浅色模板强制 `-mono` 黑变体（深色模板保留官方黄）。
11. **商标声明**：在 CREDITS 与免责声明补充游戏 IP 专门说明（归各自权利人，经授权使用，不暗示关联或背书）。
12. **lens 组**：本轮一并核对 10 个纯镜头品牌 → 审计范围 47 → 57 项。


