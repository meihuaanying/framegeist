# 第三方素材与许可（CREDITS）

FrameGeist 本体代码为 MIT。以下随包分发的素材均为可商用许可，并逐项记录来源。

## 演示照片（`templates/assets/photos/`）

NASA Image Library（美国政府作品，公有领域，遵循 NASA 媒体使用指南）：
详见 `templates/assets/photos/CREDITS.json`（含每张的 NASA ID、标题、拍摄者与来源链接）。
用途：模板缩略图/样张渲染的固定演示素材。

## 品牌图标（`templates/assets/brand/`、`web/brand/`）

- [Simple Icons](https://simpleicons.org)（CC0-1.0）：sony、nikon、fujifilm、leica、
  hasselblad、panasonic、ricoh、sigma、zeiss、dji、xiaomi、apple、epson、insta360。
- **文字字标**（由 FrameGeist 使用 OFL 字体自行渲染，非官方 Logo 图形）：
  canon、ricoh、sigma、zeiss、hasselblad、olympus、pentax、tamron。
- 商标声明：品牌名称与标识归各自权利人所有；本软件仅将其用于标注照片 EXIF
  中的相机/镜头品牌，不构成任何背书。详见 `templates/assets/brand/CREDITS.json`。

## 引擎字体（`templates/assets/fonts/`）

OFL-1.1（SIL Open Font License），许可原文见 `templates/assets/fonts/licenses/`：

| 字体 | 来源 |
|---|---|
| Inter / Playfair Display / Bebas Neue / Oswald / Cormorant Garamond / Space Grotesk | Google Fonts（google/fonts，OFL） |
| Noto Sans SC / Noto Serif SC | notofonts/noto-cjk（OFL；GB2312 一级常用字子集） |
| JetBrains Mono | JetBrains（OFL） |

## 界面字体（`web/fonts/`、`site/fonts/`）

Host Grotesk、DM Sans（OFL-1.1，自托管 latin 子集）。

## 模板

内置模板（`templates/*.json`）由 FrameGeist 原创生成（`tools/gen-templates.mjs`），
许可以模板 meta 为准（当前全部 CC0-1.0）。
