# 第三方素材与许可（CREDITS）

FrameGeist 本体代码为 MIT。以下随包分发的素材均为可商用许可，并逐项记录来源。

## 演示照片（`templates/assets/photos/`）

11 张真实摄影（3 风光 + 2 建筑 + 街景/雾气/黄昏城市/人像/人物/方形草莓），详见 `CREDITS-DEMO.json`：
- Lorem Picsum（**Unsplash License**，免费商用，建议署名）：Fjord #1015、Canyon #1016、Snow #1036、Skyline #1029、Castle #1040、Street #1071、Mist #1044、Dusk #1067、Portrait #1027、Canoe #1011、Strawberries #1080。

用途：模板缩略图（240px）/ 应用内预览（640px）/ 样张（900px）的分分类演示素材。

## 品牌图标（`templates/assets/brand/`、`lockup/`、`series/`、`game/`、`web/brand/` 等，v0.7.0–v0.9.0 扩展）

- **官方字标**：[Simple Icons](https://simpleicons.org)（CC0-1.0）。v0.9.0 起仅保留官方仍在维护的
  **19 个图标**（15 彩色 / 4 单色）：nikon、fujifilm、leica、panasonic、epson、insta360、samsung、
  vivo、oppo、oneplus、huawei、google、motorola、nokia、blackmagicdesign 为彩色；sony、dji、apple、honor
  官方色即黑/白，保持单色。Simple Icons 已下架的品牌（canon、hasselblad、ricoh、sigma、zeiss、tamron、
  olympus、pentax、gopro、sandisk、phaseone、profoto、smallrig 等）**不臆造官方色**，一律使用本项目原创排版 mono。
  清单与官方 hex 锁定于 `tools/brand-colors.json`（`officialColors` 快照同步在
  `templates/assets/brand/CREDITS.json`）。
- **彩色判定阈值规则**（v0.9.0）：hex→HSL，`s ≥ 0.18 且 0.10 ≤ l ≤ 0.90` 判为彩色品牌（其主变体直接用官方 hex 绘制）；
  其余保持黑/白。允许通过 `tools/brand-colors.json` 的 `monoOverride` 名单人工覆盖（当前为空）。
- **下架品牌官方色与字形**（v0.9.2/v0.9.3）：Simple Icons 已下架的品牌中，Canon 使用公开的官方红
  （Pantone 186 C ≈ `#C8102E`）为**原创排版字标**着色（`tools/brand-colors.json` 的 `originalColorOverride`；当前仅 canon），
  字形自 v0.9.3 起改用 Noto Serif SC 700 排版以贴近官方观感；**不是官方矢量徽记**。
  `brand/canon` 与 `lockup/canon` 主变体为红，`-mono` 黑 / `-light` 白回退保留。
- **徽章库分组**（v0.9.3，manifest v4）：相机品牌 18 · 手机品牌 10（apple/google/honor/huawei/motorola/nokia/oneplus/oppo/samsung/vivo）·
  镜头品牌 28 · 系列徽章 13 · 游戏字标 6。
- **变体矩阵**（v0.9.0）：`brand/<slug>.png` 主变体（彩色品牌=官方色，单色品牌=黑）· `brand/<slug>-mono.png`
  黑色单色（新增）· `brand/<slug>-light.png` 白色；`lockup/` 同品牌同色；`series/`、`game/` 仅黑/白两版。
  96px 缩略图 `*/thumbs/<slug>[-mono|-light].png` 与 512px 同源渲染。像素级校验门禁：
  `node tools/check-brand-colors.mjs`（128/128）。
- **原创排版字标/ Lockup**（由 FrameGeist 使用 OFL 字体排版渲染，**非官方 Logo 图形**）：
  canon、ricoh、sigma、zeiss、hasselblad、olympus、pentax、tamron、viltrox、laowa、ttartisan、
  tokina、samyang、meike、7artisans、sirui、yongnuo、voigtlander、phaseone、blackmagicdesign 等；
  `lockup/` 为全品牌（42 slug）的原创排版款，供编辑器「官方/原创」风格切换。
- **镜头系列徽章**（原创字标）：GM、G、L、RF L、S、ART、DG DN、APO、XCD、XF、BATIS、SP。
- **游戏主题字标**（原创文字渲染，非官方素材；仅作风格标注）：
  GENSHIN、ZZZ、HONKAI、ARKNIGHTS、燕云十六声、WUKONG。
- **中性「EXIF」标**（v0.8.0）：`brand/exif-auto` 与 `-light` 变体，FrameGeist 原创排版，用于表达式徽标层的占位/卡片标记。
- **v0.8.0 补充资产**：`series/leica-apo`（LEICA APO 系列徽章）、`brand|lockup/voigtlander`（福伦达）。
- **相框线稿**（`templates/assets/frame/`）：camera-body / phone-frame / film-strip，FrameGeist 原创矢量（`tools/gen-frame-assets.mjs`）。
- **商标声明**：各品牌字标/商标归其权利人所有，本项目仅作**器材信息识别展示**用途，
  不表示隶属、赞助或背书；原创 lockup 不复制官方图形徽记。彩色化仅使用 Simple Icons 的 hex 元数据与该库单色路径重绘，
  不引入多色官方插画。详见 `templates/assets/brand/CREDITS.json`。

## 引擎字体（`templates/assets/fonts/`，v0.8.0：69 faces / 23 families）

全部 **OFL-1.1**（SIL Open Font License）；许可原文：`templates/assets/fonts/licenses/`，
副本与来源/版本/SHA256 清单：`docs/licenses/fonts/`（`SOURCES.md`）。

| 字体（family） | 字重 | 来源/版本 | 说明 |
|---|---|---|---|
| Inter、Playfair Display、Oswald、Cormorant Garamond、Space Grotesk | 400/500/600/700 | google/fonts（可变字体实例化） | 由 `tools/instance-fonts.py` 钉轴生成静态实例并子集化 |
| Fraunces、Bricolage Grotesque、Instrument Sans、Geist、Geist Mono、Onest、Unbounded | 400/500/600/700 | google/fonts（v0.7.0 新引入） | 同上；Unbounded 仅 400 |
| Instrument Serif | 400 | google/fonts（v0.8.0 补齐） | 静态 400；编辑杂志类 Display 行使用 |
| Bebas Neue、Great Vibes | 400 | google/fonts | 静态 |
| JetBrains Mono | 400/500/700 | JetBrains/JetBrainsMono | 静态（可选项） |
| Ma Shan Zheng | 400 | google/fonts | CJK，GB2312 一级 + 仓库用字子集 |
| Noto Sans SC | 400/500/700 | notofonts/noto-cjk | CJK 子集 |
| Noto Serif SC | 400/600/700 | notofonts/noto-cjk | CJK 子集 |
| LXGW WenKai 霞鹜文楷 | 400/500 | lxgw/LxgwWenKai v1.522 | CJK 子集 |
| Smiley Sans 得意黑 | 400（Oblique） | atelier-anchor/smiley-sans v2.0.1 | CJK 子集 |
| Glow Sans SC 未来荧黑 | 400/500/700 | welai/glow-sans v0.93 | CJK 子集 |
| Sarasa Gothic SC 更纱黑体 | 400/700 | be5invis/Sarasa-Gothic v1.0.41 | CJK 子集 |

字体源文件（大体积原始可变字体/发布包）在 `templates/assets/fonts/source/`（**不随包分发**，
由 `node tools/fetch-fonts.mjs --fetch` 按 SHA256 重建）。

## 界面字体（`web/fonts/`、`site/fonts/`）

Host Grotesk、DM Sans（OFL-1.1，自托管 latin 子集）；v0.7.0 新增 **Geist VF**（可变字体，
latin 子集，`web/fonts/ui/Geist-VF.woff2`，来自 google/fonts，OFL-1.1）用于 UI 标题。

## HEIC 解码（`web/vendor/libheif/`，v0.6.0）

- [libheif-js](https://github.com/catdad-experiments/libheif-js) **v1.23.2**（Kiril Vatev；npm `libheif-js`），
  基于 [strukturag/libheif](https://github.com/strukturag/libheif) 的 Emscripten WASM 构建，**LGPL-3.0**。
  预打包 wasm 变体 `libheif-wasm/libheif-bundle.mjs` 以**独立外部文件**随包分发
  （`web/vendor/libheif/libheif-bundle.mjs`），仅在用户拖入 HEIC/HEIF 时通过动态 `import()` 惰性加载，
  不被静态内联进应用代码；加载失败（首次离线访问）时优雅降级为本地化提示。
- 许可原文（npm 包 LICENSE 逐字拷贝）：`docs/licenses/libheif-js-LGPL-3.0.txt`
  （sha256 `e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118`）。
- 来源与校验：npm tarball `libheif-js-1.23.2.tgz`
  （sha256 `728cf3795a94b18039ac07c6d38c089b72f1eeae12c37bc9f18b0925fc709daa`）；
  vendored 文件 sha256 `d05292271af008d300cc75be374feb8fd35b418a71420a556c3fb817f662b502`。

## 模板

内置模板（`templates/*.json`）由 FrameGeist 原创设计（v0.4.0 起为手工创作/子 Agent 设计产出，
清单由 `tools/gen-templates.mjs` 扫描重建），许可以模板 meta 为准（当前全部 CC0-1.0）。

## 示例摄影（v0.6.0）

`web/examples/` 三张示例照片与 192 张 showcase 样片注入的 EXIF 元数据，来源于用户提供的三张
自有摄影作品（1× SONY ILCE-7RM3、1× NIKON Z 6_2、1× Canon EOS R7）。原片不入仓
（`incoming/` 已 gitignore）；入库派生物为压缩至长边 ≤2560、质量 92 的 JPEG。
署名：**由用户提供的示例摄影**（如作者需要具名，请在仓库 Issue 中告知）。
样片展示照片本体仍来自 Lorem Picsum（作者与许可见 `templates/assets/photos/CREDITS-DEMO.json`）。
