# 第三方素材与许可（CREDITS）

FrameGeist 本体代码为 MIT。以下随包分发的素材均为可商用许可，并逐项记录来源。

## 演示照片（`templates/assets/photos/`）

11 张真实摄影（3 风光 + 2 建筑 + 街景/雾气/黄昏城市/人像/人物/方形草莓），详见 `CREDITS-DEMO.json`：
- Lorem Picsum（**Unsplash License**，免费商用，建议署名）：Fjord #1015、Canyon #1016、Snow #1036、Skyline #1029、Castle #1040、Street #1071、Mist #1044、Dusk #1067、Portrait #1027、Canoe #1011、Strawberries #1080。

用途：模板缩略图（240px）/ 应用内预览（640px）/ 样张（900px）的分分类演示素材。

## 品牌图标（`templates/assets/brand/`、`web/brand/`）

- [Simple Icons](https://simpleicons.org)（CC0-1.0）：sony、nikon、fujifilm、leica、
  hasselblad、panasonic、ricoh、sigma、zeiss、dji、xiaomi、apple、epson、insta360。
- **文字字标**（由 FrameGeist 使用 OFL 字体自行渲染，非官方 Logo 图形）：
  canon、ricoh、sigma、zeiss、hasselblad、olympus、pentax、tamron。
- **镜头系列徽章**（原创字标）：GM、L、S、ART、DG DN、XCD、XF。
- **游戏主题字标**（原创文字渲染，非官方素材；仅作风格标注）：
  GENSHIN、ZZZ、HONKAI、ARKNIGHTS、燕云十六声、WUKONG。
- **相框线稿**（`templates/assets/frame/`）：camera-body / phone-frame / film-strip，FrameGeist 原创矢量（`tools/gen-frame-assets.mjs`）。
- 商标声明：品牌名称与标识归各自权利人所有；本软件仅将其用于标注照片 EXIF
  中的相机/镜头品牌，不构成任何背书。详见 `templates/assets/brand/CREDITS.json`。

## 引擎字体（`templates/assets/fonts/`）

OFL-1.1（SIL Open Font License），许可原文见 `templates/assets/fonts/licenses/`：

| 字体 | 来源 |
|---|---|
| Inter / Playfair Display / Bebas Neue / Oswald / Cormorant Garamond / Space Grotesk | Google Fonts（google/fonts，OFL） |
| Noto Sans SC / Noto Serif SC / Ma Shan Zheng | notofonts/noto-cjk、google/fonts（OFL；GB2312 一级常用字子集） |
| JetBrains Mono | JetBrains（OFL） |
| Great Vibes | google/fonts（OFL） |

## 界面字体（`web/fonts/`、`site/fonts/`）

Host Grotesk、DM Sans（OFL-1.1，自托管 latin 子集）。

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
