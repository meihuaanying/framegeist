# FrameGeist 模板规格（TEMPLATE-SPEC）

> 版本 v0.5 ｜ 对应引擎 `framegeist-core` v0.5.x ｜ 机器可读 schema：`docs/schema/template.schema.json`
> 模板是**声明式 JSON**（C1），不可执行代码、不可联网、不可读包外路径（C2）。本文件是模板语言唯一的语义来源；引擎内置校验器按本规格执行，JSON Schema 文件是同规格的机器可读对照。
> v0.5 起文本由 cosmic-text 0.19 + swash 整形/栅格化，全部字效作用于字形 alpha 掩膜（见 §4.5e/§4.5k）。
> 设计语言见 `docs/DESIGN-LANGUAGE.md`（v0.4.0 起模板必须遵循；v0.5 字效与艺术风格见其附录）。

## 1. 文件与尺寸限制

| 项 | 限制 |
|---|---|
| 模板 JSON 体积 | ≤ 256 KB（`MAX_TEMPLATE_JSON_BYTES`） |
| 字段表达式长度 | ≤ 512 字符 |
| `fallback` 文本 | ≤ 256 字符 |
| `content` 条目数 | 1–64 |
| `font.family` 条目数 | 1–8，每项 1–64 字符 |
| `layers[].id` | 1–64 字符，`[a-zA-Z0-9-]` |
| `layers[].children`（group） | 1–32 个子层，可嵌套 |
| `layers[].z` | 整数 -1000–1000，缺省 0（见 §4.5j） |
| `meta.id` | 3–64 字符，`[a-z0-9-]`，首字符 `[a-z0-9]` |
| 未知字段 | 一律拒绝（`deny_unknown_fields`） |

## 2. `meta`

| 字段 | 说明 |
|---|---|
| `id` | 模板唯一标识，全局唯一（市场查重键） |
| `name` | 展示名，1–64 字符 |
| `version` / `minEngineVersion` | semver `X.Y.Z`；引擎版本低于 `minEngineVersion` 时拒绝加载（C8） |
| `author` | 署名，**强制保留且不可被下游删除**（E5） |
| `license` | 枚举：`CC0-1.0 / CC-BY-4.0 / CC-BY-SA-4.0 / OFL-1.1 / Apache-2.0 / MIT` |
| `category` | v0.4 起枚举（29 值，v0.5 未变）：新分类 `white-border / camera / phone / drone / fuji / film / colorwalk / colorful / classic-watermark / portfolio / black-frame / sports / calendar / magazine / minimal / borderless / master / personal / polaroid / festival / effect / colorcard / blur-bg / ticket / game`；旧值 `classic-white / gallery / technical / frame-shell` 保留可加载（迁移映射：classic-white→white-border、frame-shell→camera、gallery→portfolio、technical→classic-watermark） |
| `nameI18n` | 可选 `{"zh": "…", "en": "…"}`，客户端按界面语言显示（缺失回退 `name`） |
| `notice` | 可选免责声明（游戏模板使用："Unofficial fan-made design…"） |

## 3. `canvas`

### 3.1 `mode`

| 值 | 语义 |
|---|---|
| `extend` | 画布外扩：`padding` 在照片四周留白 |
| `overlay` | 画布 = 照片原尺寸，图层直接叠加 |
| `cover` | 骨架阶段与 `overlay` 等价；v1.x 扩展为「照片裁切充满画布」 |

### 3.2 `padding`（仅 `extend` 生效）

四个值均为**比例**：`left`/`right` 相对照片**宽度**，`top`/`bottom` 相对照片**高度**，取值 `[0, 1]`。

### 3.3 `background`

| `type` | 语义 |
|---|---|
| `solid` | 纯色填充，`color` 为 `#RRGGBB` 或 `#RRGGBBAA`；缺省白 |
| `blur` | 照片放大 `scale`（默认 1.2，[1,4]）至覆盖画布，按 `blur`（[0,200]，实现为 3-pass box blur）模糊后居中裁切 |
| `image` | 包内图片（`asset`）或 `@user/background` 铺满；缺失回退纯色 |
| `tint` | **v0.4 新增**：照片平均色填充画布（ColorWalk 无缝延伸）；`color` 可覆盖 |
| `texture` | **v0.5 新增**：纸纹/噪点纹理。`asset` 指向包内 / `@user/` 纹理图（cover 适配）；缺省用确定性程序纸纹（hash 噪声，无资产、跨端字节一致）。纹理与 `color`（缺省白）按 8% 不透明度混合，保持细微 |
| `none` | 不处理背景（透明/保留照片） |

### 3.4 `radius` / `shadow`（v0.4 起实际渲染）

- `radius`：照片四角圆角，**相对 min(照片宽, 照片高) 的比例**（0–0.25）；预览与导出等比一致。
- `shadow`：照片投影。`blur`/`offsetX`/`offsetY` 为**相对照片高度的比例**（blur 0–0.5、offset ±0.5），`opacity` 0–1；`enabled:false` 关闭。仅在 `extend` + 非 `none` 背景时绘制（否则入画布即被照片覆盖或无底可见）。

## 4. `layers[]`

`type` 支持 `text` / `image` / `shape`（v0.4）/ `palette`（v0.4）/ `group`（v0.5）/ `calendar`（v0.5）。

### 4.1 锚点与偏移（九宫格）

`anchor` ∈ 9 值（`top-left` … `bottom-right`）。`offset.x/y` 为相对**画布**宽/高的**带符号位移**（`[-1, 1]`），约定：**正方向 = 右/下**，因此**右/下锚点的"向内"偏移取负值**：

- **Left 列**：`x = offset.x * W`（正 = 向内）
- **Right 列**：`x = W + offset.x * W - textW`（**负 = 向内**）
- **Center 列**：`x = (W - textW) / 2 + offset.x * W`
- **Top 行**：`y = offset.y * H`（正 = 向下向内）
- **Middle 行**：`y = (H - textBlockH) / 2 + offset.y * H`
- **Bottom 行**：`y = H + offset.y * H - textBlockH`（**负 = 向上向内**）

> 引擎回归测试 `visual_sanity.rs` 锁住这一语义（底部文字必须真实落进画布，防止偏移符号再漂）。

### 4.2 `font`

- `size`：相对**照片高度**的比例 `(0, 0.5]`
- `family`：回退链（D4），按**字体目录内文件名**解析：`JetBrainsMono-Regular.ttf` → `jetbrainsmono`（小写、去空格/下划线、去 `-权重` 后缀）
- `color`：`#RRGGBB[A]`，或 `"auto"`（按文字区域背景亮度自动选黑/白）
- `weight`：100–900；v0.5 起经 cosmic-text 选择对应字重/可变轴字面，无匹配时回退最近字面（v0.4 及以前忽略单字重文件）

### 4.3 `content[]` 与字段表达式（C3）

白名单文法（引擎 `sandbox.rs` 单一实现，五端共享）：

| 形式 | 求值 |
|---|---|
| `exif.<key>` | 直接取字段，见下表 |
| `'<literal>'` | 常量文本（C3） |
| `fmt('<literal>', exif)` | `{key}` 占位替换；**任一 key 缺失 → 整条为 None**（走 `fallback`） |
| `if_empty(exif.<key>, '<literal>')` | 值为空/缺失时取字面量 |
| `date('<format>', exif.datetime)` | EXIF 日期（`YYYY:MM:DD HH:MM:SS`）重排 |

`date()` token（v0.4）：`YYYY MM MMM MMMM M`（年/月补零/月缩写/月全称/月不补零）、`DD Do D`（日补零/英文序数 15th/日不补零）、`HH mm SS`、`WW`（英文星期 Wednesday）。其余字符原样输出；**格式串内的文字避免大写 D/M/S/H 等 token 字母**（如 "Documentary" 中 `Do` 会被拆解），需要英文月/星期一律用 token。

条目求值结果为 `None` 时取该条目的 `fallback`（可为 `null` = 整行省略）。全部条目为空 → **整层隐藏**（条件显示）。

`exif.<key>` 取值表：

| key | 来源 | 格式化 |
|---|---|---|
| `make` | EXIF Make | 原样 |
| `model` | EXIF Model | 原样 |
| `model_pretty` | B5 机型美化映射 | 命中映射表用官方写法，否则回退 `model` |
| `lens` | LensModel | 原样 |
| `focal` | FocalLength | `35`（整数 mm） |
| `aperture` | FNumber | `1.4`（一位小数） |
| `shutter` | ExposureTime | `1/500s` 或 `2.0s` |
| `iso` | PhotographicSensitivity | 整数 |
| `datetime` | DateTimeOriginal | `YYYY:MM:DD HH:MM:SS` |
| `orientation` | Orientation | 1–8 整数 |
| `brand_slug` | Make/Model 映射 | `sony` 等 |
| `lens_slug` / `lens_series` | LensModel 映射 | v0.2/v0.3 |
| `weekday` / `weekday_cn` | datetime 推算 | `Wednesday` / `星期三`（v0.4） |
| `gps_lat` / `gps_lon` | EXIF GPS | `23°8'13"N` / `113°19'28"E`（v0.4） |
| `gps_latlon` | GPS | `23°8'13"N 113°19'28"E`（v0.4） |
| `gps_alt` | GPSAltitude | `2459m`（v0.4） |
| `film_mode` | 富士 MakerNote FilmMode 映射 | `Classic Negative` / `Nostalgic Neg` / `Reala ACE` 等（v0.5） |
| `wb_mode` | 富士 WhiteBalance 映射 | `Auto` / `Daylight` / `Kelvin` 等（v0.5） |
| `wb_shift_r` / `wb_shift_b` | 富士 WhiteBalanceFineTune | 带符号整数如 `+2` / `-3`（v0.5） |
| `grain` / `color_chrome` / `chrome_fx_blue` | 富士 Grain / ColorChrome / FX Blue | `Off / Weak / Strong`（v0.5） |
| `dynamic_range` | 富士 DynamicRange | `Auto / DR100 / DR200 / DR400 / DR800`（v0.5） |
| `highlight_tone` / `shadow_tone` | 富士 高光/阴影色调 | 一位小数带符号如 `+1.0` / `-2.0`（v0.5） |
| `fuji_sharpness` / `fuji_saturation` | 富士 锐度/色彩 | `-2 (Softest) … +2 (Hardest)` / `Normal / High / Low …` 等（v0.5） |
| `fuji_clarity` | 富士 Clarity（MakerNote 0x100F，千分位 -5..+5） | `-5 … +5`；非千分位/越界值隐藏（v0.5） |
| `fuji_nr` | 富士降噪：0x100E（新机型）+2(strong)…-4(weakest)，回退 0x100B Low/Normal | 解析值文本；0x100B 的 0x100("n/a") 隐藏（v0.5） |
| `fuji_lut1` / `fuji_lut2` | 富士 LUT 名称 | **恒隐藏**：Fujifilm MakerNote 无 LUT 标签（ExifTool/Exiv2 表均无；LUT 元数据属松下/索尼），保留键位、绝不臆造 |

> **富士配方（v0.5）**：全部键为**尽力解析**（Fujifilm MakerNote），解析不到返回 `None`（整行隐藏），**绝不编造默认值**；`fuji_lut1 / fuji_lut2` 无对应 MakerNote 标签，始终隐藏。

> **GPS 隐私（B3）**：GPS 表达式仅在渲染参数 `keep_gps=true`（用户显式开启）时求值；默认返回 None（走 `fallback`，通常整层隐藏）。

### 4.4 行高

`lineHeight`（默认 1.3，[0.5, 4]）：行间距 = `size_px * lineHeight`；多行文本总高 = `(n-1) * lineH + lastLineH`。

### 4.5 图片层（`type: "image"`，v0.2.0）

```jsonc
{
  "type": "image", "id": "brand",
  "anchor": "bottom-left",
  "offset": { "x": 0.02, "y": -0.05 },
  "asset": "@builtin/brand/{exif.brand_slug}",   // 支持 {exif.<key>} 占位
  "size": { "height": 0.03 },                     // 相对照片高度（优先）；或 width
  "opacity": 1.0,
  "attachTo": "primary",                          // 贴附到文本层首行左侧（水印行前置图标）
  "attachGap": 0.01                               // 贴附间距（相对照片高度）
}
```

- **asset 解析顺序**：调用方内存资产表（`@user/logo`、`@user/background` 等）→ `@builtin/*`（`brand/<slug>.png`）→ `assets/*`（模板包内相对路径）。**解析失败 = 留白，不显示替代图标**（v0.2.0 决策）。
- **占位表达式**：`{exif.brand_slug}` / `{exif.lens_slug}`（品牌/镜头映射见 §8）。
- `attachTo` 必须在同一模板内引用存在的文本层 id（加载时校验）；贴附位置 = 文本首行左侧，垂直居中。
- `showLogo=false` 覆盖时，`@builtin/brand/`、`@builtin/lens/` 资产层整体跳过。

### 4.5b 文本层扩展（v0.4.0）

| 字段 | 取值 | 语义 |
|---|---|---|
| `letterSpacing` | -0.05–0.5（em） | 字距，微排版刚需（大写小字 0.06–0.22） |
| `rotation` | -360–360（度） | 绕文本块中心旋转（差值为 0.01 度以内不旋转） |
| `opacity` | 0–1 | 文本层不透明度（水印 0.75–0.95） |
| `align` | `left/center/right` | 逐行对齐；缺省跟随锚点列 |

### 4.5c 形层（`type: "shape"`，v0.4.0）

```jsonc
{
  "type": "shape", "id": "rule",
  "anchor": "middle-center",
  "shape": "line",                       // line | rect | ellipse | diamond | hexagon
  "size": { "width": 0.6, "height": 0.002 },  // 宽相对照片宽、高相对照片高
  "color": "#E4E6EA",
  "opacity": 1.0,
  "radius": 0.0,                         // rect 圆角（相对 min(w,h)，0–0.5）
  "strokeWidth": 0.002,                  // 可选：描边（相对照片宽）；缺省实心
  "rotation": 0.0
}
```

默认尺寸：line `0.2 × 0.0015`；rect `0.2 × 0.2`；ellipse/diamond/hexagon `0.05 × 0.05`。用于分隔线、双线框、圆点、色块。

### 4.5d 色卡层（`type: "palette"`，v0.4.0）

```jsonc
{
  "type": "palette", "id": "chips",
  "anchor": "bottom-left", "offset": { "x": 0.06, "y": -0.08 },
  "count": 5,                            // 2–8，取照片主色
  "shape": "circle",                     // circle | square | diamond | hexagon | strip
  "direction": "horizontal",             // horizontal（默认）| vertical
  "size": 0.035,                         // 色块尺寸（相对照片高）
  "gap": 0.012,                          // 间距（默认 size*0.35）
  "showHex": true,
  "label": { "size": 0.012, "color": "#6B7280", "family": ["JetBrains Mono"] }
}
```

主色由引擎对照片做确定性 median-cut（64×64 采样、按聚类大小排序、去近似色）提取；模板不声明具体颜色。

### 4.5e 文本效果矩阵（`effects`，v0.5.0）

`effects` 只属于文本层；所有效果作用于 cosmic-text + swash 整形出的**字形 alpha 掩膜**（见 §4.5k），因此 CLI/WASM/桌面三端像素一致。效果可任意组合，**固定后处理顺序**：

1. `shadow`（外阴影，最底）→ 2. `stroke`（描边圈）→ 3. `relief` 的 `engrave`/`inner-shadow` → 4. `fill`（经掩膜上色）→ 5. `relief` 的 `emboss`/`letterpress`（覆于填充之上）。

所有相对尺寸（描边宽、双线间距、浮雕深度、阴影偏移/模糊）以 `mask_unit` 换算像素：**`mask_unit` = 首行基线到文本块顶的距离（em 代理值）**，保证不同字号下效果比例稳定。

| 子对象 | 字段 | 取值 | 语义 |
|---|---|---|---|
| `stroke` | `width` | 0.005–0.5（相对 font size） | 外描边宽度（距离场膨胀，真外扩） |
| | `color` | `#RRGGBB[A]` | 描边色 |
| | `double` | bool（默认 false） | 双线：外圈 + 内圈细圈 |
| | `gap` | 0–0.5（默认 = `width`） | 双线间距 |
| `relief` | `mode` | `emboss` / `engrave` / `letterpress` / `inner-shadow` | 浮雕 / 凹刻 / 凸版压印 / 内阴影 |
| | `depth` | 0.01–0.3（默认 0.06） | 高光/阴影偏移深度 |
| | `highlight` / `shadow` | `#RRGGBB[A]`（默认白/黑） | 高光色 / 阴影色 |
| | `opacity` | 0–1（默认 1） | 立体强度 |
| `fill` | `mode` | `gradient` / `foil` / `texture` | 渐变 / 烫金箔（含高光扫过）/ 纹理 |
| | `colors` | 2–8 个 `#RRGGBB[A]`（gradient/foil 必须 ≥2；texture 可省略） | 渐变色标；缺省由底色派生 |
| | `angle` | -360–360（默认 90 = 上→下） | 渐变角度 |
| | `texture` | `@builtin/...` / `@user/...` / `assets/...` | 纹理图；取不到回退包内纸纹，再回退底色纯色 |
| | `intensity` | 0–1（默认 1） | 效果强度 |
| `shadow` | `offsetX` / `offsetY` | -0.5–0.5（相对 font size） | 阴影偏移 |
| | `blur` | 0–0.5 | 阴影模糊半径 |
| | `color` | `#RRGGBB[A]` | 阴影色 |
| | `opacity` | 0–1（默认 1） | 阴影不透明度 |
| 顶层 | `case` | `upper` / `lower` / `title` | 大小写转换（整形前，逐行应用） |
| | `flipX` / `flipY` | bool（默认 false） | 字形掩膜水平/垂直翻转 |
| | `scaleX` | 0.5–2.0 | 字形水平拉伸（掩膜重采样） |

```jsonc
{
  "effects": {
    "stroke": { "width": 0.02, "color": "#1A1A1A", "double": true, "gap": 0.02 },
    "relief": { "mode": "emboss", "depth": 0.06, "highlight": "#FFF7D6", "shadow": "#4A3200", "opacity": 0.7 },
    "fill": { "mode": "foil", "colors": ["#8A6A1F", "#F6E27A", "#D4A017", "#FBF0B0"], "angle": 100, "intensity": 0.9 },
    "shadow": { "offsetX": 0.01, "offsetY": 0.02, "blur": 0.01, "color": "#000000", "opacity": 0.5 },
    "case": "upper", "flipX": false, "flipY": false, "scaleX": 1.0
  }
}
```

### 4.5f 文本自适应尺寸（v0.5.0）

| 字段 | 取值 | 语义 |
|---|---|---|
| `width` | 0–1 画布宽（>0） | 固定换行宽度，超出自动折行 |
| `height` | 0–1 画布高（>0） | 目标文本块高；引擎按比例缩放字号（±1px 内收敛，一次求解） |
| `stretchWidth` | bool | 横向拉伸：左/右锚点撑到对侧留 5% 边距，居中锚点撑到 90% 画布宽 |
| `stretchHeight` | bool | 纵向缩放：按锚点行可用高度（中行取半高）的 ~90% 调字号 |
| `fillPage` | bool | 填满页面：先按 90% 画布高定字号，再横向拉伸到 90% 画布宽 |

`fillPage` 优先级最高：与 `stretchWidth`/`stretchHeight` 同时出现时只执行 `fillPage`。

### 4.5g 形层扩展：双线 / 布局框 / 自动分割线（v0.5.0）

```jsonc
{
  "type": "shape", "id": "frame",
  "anchor": "middle-center",
  "shape": "rect",
  "frame": "outer",           // outer | opposite-h | opposite-v（布局框角色，忽略 size）
  "margin": 0.04,             // 布局框内缩（相对照片宽，0–0.5）
  "strokeWidth": 0.002,       // 线宽（相对照片宽；缺省 photo_h*0.002）
  "double": true,             // 双线（line / frame 生效）
  "gap": 0.004,               // 双线间距（相对照片高，0–0.2）
  "autoHide": true,           // 文本层 <2 时隐藏（自动分割线）
  "span": "auto",             // 线段自动取两内边距之间的宽度（margin 缺省 0.06 照片宽）
  "color": "#E4E6EA",
  "z": 3
}
```

| 字段 | 取值 | 语义 |
|---|---|---|
| `double` | bool（默认 false） | `line` 画两条平行线；`frame` 画内圈细线（0.8 不透明度） |
| `gap` | 0–0.2（相对照片高） | 双线间距；line 缺省 0.006、frame 缺省 0.004 |
| `frame` | `outer` / `opposite-h` / `opposite-v` | 四边框 / 上下两边 / 左右两边；按照片与 `margin` 计算，忽略 `size` |
| `margin` | 0–0.5（相对照片宽） | 布局框内缩 |
| `autoHide` | bool（默认 false） | 模板内文本层少于 2 个时整层隐藏 |
| `span` | `"auto"` | 线段宽度自动取内边距之间的可用宽度 |

### 4.5h 群组层（`type: "group"`，v0.5.0）

```jsonc
{
  "type": "group", "id": "footer",
  "anchor": "bottom-left",
  "offset": { "x": 0.06, "y": -0.08 },
  "width": 0.5,               // 可选，群组盒尺寸（相对画布；缺省 = 画布宽/高）
  "height": 0.1,
  "opacity": 0.9,             // 群组整体不透明度
  "children": [ /* 1–32 个子层；坐标相对群组盒 */ ],
  "z": 10
}
```

- 子层锚点相对**群组盒**（不是照片），整体按 `opacity` 合成回画布。
- **群组内按声明顺序绘制**（组内不做 z 排序；`z` 只在顶层生效）。
- `attachTo` 定位只在**同一绘制作用域**内生效：组内图片只能贴附组内文本层，跨群组引用（组内引组外 / 组外引组内）拿不到目标布局，图片层直接跳过绘制（校验不报错）。
- 群组可嵌套（子层再次为 `group`）；总层数与模板体积仍受 §1 限制。

### 4.5i 日历层（`type: "calendar"`，v0.5.0）

```jsonc
{
  "type": "calendar", "id": "cal",
  "anchor": "bottom-right",
  "offset": { "x": -0.06, "y": -0.08 },
  "size": 0.28,               // 日历宽度（相对画布宽，0.05–0.6，默认 0.3）
  "dateSource": "exif",       // exif（默认，取照片日期）/ fixed（用 year/month）
  "year": 2026, "month": 9,   // fixed 使用；exif 解析失败时作为回退
  "showLunar": true,          // 阴历日号（默认 true）
  "showWeekdays": true,       // 星期表头（默认 true）
  "view": "month",            // month（默认）/ week / day / strip
  "binding": false,           // v0.5：月视图装订线装饰（细虚线折痕 + 顶边等距刻痕，低透明度，默认关）
  "color": "#1A1A1A",
  "accent": "#E10600",
  "fontFamily": ["Inter"],    // ≤2，缺省 Inter
  "z": 5
}
```

| `view` | 内容 |
|---|---|
| `month`（缺省） | 年.月 + 星期表头 + 6×7 网格；当日日号用 `accent` 高亮 |
| `week` | **v0.5 新增**：所在周的周一起 7 日单行（可选星期表头 + 公历日号 + `showLunar` 阴历标签），当日用 `accent` 高亮 |
| `day` | 两位大日号 + 日期标签 |
| `strip` | 单行「2026.09 九月初三」式文本 + `accent` 细线 |

- `binding:true` 仅作用于 **month** 视图：日历块水平中心一条低透明度虚线折痕（沿第 3/4 列间隙，不压日号），顶边等距刻痕在表头文字区自动跳过；装饰面积小，不是底色填充。
- `dateSource:"exif"` 取 `datetime` 年/月，解析失败回退显式 `year`/`month`，两者都无 → **整层隐藏**（不造假）；`fixed` 固定为 `year`/`month`（日号显示 01）。
- 阴历为**尽力标注**：1900–2100 用压缩表换算，范围外只显示公历（绝不编造）。
- 日历层依赖 cosmic-text 整形器：`--legacy-text-renderer` 下整层跳过（见 §4.5k）。

### 4.5j 图层 `z` 与绘制顺序（v0.5.0）

- 所有层可选 `z`（整数 -1000–1000，缺省 0）：**z 小者先画（在下）**，z 相同保持 JSON 声明顺序；照片恒在最底。
- `attachTo` 图片层固定最后绘制（不受 `z` 影响）；群组作为整体参与顶层 z 排序。
- 群组内部子层按声明顺序绘制，不参与组外排序。

### 4.5k 文本引擎：整形器与回退（v0.5.0）

- 默认路径：**cosmic-text 0.19 + swash**——HarfRust 整形（kerning、连字、`weight` 字重选择/可变轴）、swash 轮廓与栅格化；字效全部在字形 alpha 掩膜上做后处理，保证四端（CLI/WASM/桌面/移动）像素一致。
- 掩膜语义：`mask_unit` = 首行基线（em 代理值），所有相对效果尺寸按它换算；效果全部是掩膜后处理，跨端输出保持字节一致。
- `--legacy-text-renderer`（CLI 全局开关 / `RenderOptions::legacy_text_renderer`）：回退 v0.4 的 ab_glyph 路径，仅用于**回归对照/低配兜底**；该路径**不渲染 `effects`、自适应尺寸与日历层**，作者不得用它验收 v0.5 模板。

### 4.6 渲染覆盖（TemplateOverrides，v0.2.0 UI 能力）

| 字段（camelCase JSON） | 取值 | 语义 |
|---|---|---|
| `fontSizeScale` / `paddingScale` | 0.5–2.0 | 字号/内边距比例倍率 |
| `textColor` | `#RRGGBB[A]` | 覆盖全部文本颜色 |
| `fontFamily` | 字符串 | 字体覆盖（置于每层 family 链首） |
| `aspect` | `1:1/4:3/3:2/16:9/9:16/original` | 扩画布到目标比例（居中、背景填充，不裁切） |
| `background` | `blur/solid/image/tint/texture/none` | 覆盖模板背景类型（image 用 `@user/background` 或模板 `background.asset`；**v0.5** 新增 `tint`：照片平均色铺底；`texture`：纸纹/噪点，缺省程序纸纹，可配 `textureAsset`） |
| `backgroundColor` | 颜色 | 纯色背景色（`texture` 时作为纹理混合底色） |
| `textureAsset` | `@builtin/...` / `@user/...` / `assets/...` | **v0.5**：纹理背景图（cover 适配、8% 混合）；资产缺失自动回退程序纸纹，不报错 |
| `margin` | 0–0.5 | **v0.5**：统一附加画布边距（`extend` 下四边叠加到 `canvas.padding` 并夹取 ≤1；与比例扩展一致） |
| `card` | `{enabled, radius, shadow{enabled,blur,opacity,offsetX,offsetY}, border{width,color}, innerShadow{enabled,blur,opacity,offsetX,offsetY}}` | **v0.5**：卡片特效覆盖——`radius` 0–0.25、`shadow` 同 `canvas.shadow`、`border.width` 0–0.05（相对 min(照片宽,高)）、`border.color` 十六进制；`radius`/`shadow` 复用画布绘制路径，边框绘于阴影后、照片前（落在卡片外缘）；`innerShadow` **v0.5**：沿圆角卡片内缘压暗的内阴影，`blur` 0–0.5、`opacity` 0–1、`offsetX`/`offsetY` ±0.5（相对 min(照片宽,高)），绘于照片合成之后（只作用于 `card.enabled` 非 false 的卡片）；`radius`/`shadow`/`innerShadow` 的 `enabled` 均缺省 true；`card.enabled:false` 关闭全部卡片装饰 |
| `flipHorizontal` / `flipVertical` | bool | 照片像素翻转（在 EXIF 方向之后应用） |
| `showLogo` | bool | 品牌图片层开关（见 4.5） |
| `metadata` | bool（默认 true） | **v0.5**：保留输出 EXIF 元数据；false 时输出照片不带 EXIF（GPS 仍受 `keep_gps` 独立控制） |
| `crop` | `{x, y, w, h}`（归一化 0–1，原点左上） | **v0.5**：渲染前裁切照片（**先于布局**，所有画布尺寸/锚点基于裁后照片）；`w`/`h` 引擎夹取 ≥0.01 |

## 8. 品牌/镜头/系列映射（v0.2.0+）

`exif.lens_series`（v0.3.0）：由 LensModel 推断系列徽章 slug（`sony-gm / canon-l / nikon-s / sigma-art / sigma-dgdn / hasselblad-xcd / fujifilm-xf`），模板可引用 `@builtin/series/{exif.lens_series}`，无匹配留白。

**自动对比度（v0.3.0）**：所有文本层在绘制前采样文字区域背景平均亮度（WCAG 相对亮度）；模板色对比度 < 2.5:1 时自动切换为黑/白较优者；`color:"auto"` 强制自动；用户手动覆盖色不受自动修改（UI 提示对比风险）。

**徽章自适应（v0.3.0）**：`@builtin/brand|series|game/*` 图片层默认 `tint:"auto"`——按落点区域背景亮度自动选用 `-light` 或深色变体；`tint:"light"|"dark"` 可固定。

**@builtin/frame/\***：内置原创线稿素材（camera-body / phone-frame / film-strip，黑/浅两版，由 `tools/gen-frame-assets.mjs` 生成）。

`exif.brand_slug`：Make 优先、Model 兜底，忽略大小写的子串匹配（sony/nikon/canon/fujifilm/leica/hasselblad/panasonic/ricoh/sigma/zeiss/dji/xiaomi/apple/olympus/pentax/epson/insta360/tamron）。
`exif.lens_slug`：LensModel 前缀/子串（`FE `→sony、`XF/XC`→fujifilm、`RF/EF`→canon、`NIKKOR`→nikon、`DG DN`→sigma、`SUMMILUX/SUMMICRON/NOCTILUX/ELMAR`→leica、`LUMIX`→panasonic、`BATIS/TOUIT`→zeiss、`ZUIKO`→olympus、`TAMRON`、`HASSELBLAD`）。
内置图标：`templates/assets/brand/<slug>.png`（Simple Icons CC0 + 自绘字标，见 `brand/CREDITS.json`），暗色背景用 `<slug>-light.png`。

## 5. `fields`

声明块（供工具/编辑器读取字段来源），格式：`{ "<name>": { "type": "string|number", "source": "exif|constant", "transform": "model_pretty|brand_slug|identity" } }`。引擎求值不经过此块（直接按表达式），校验仅约束其结构。

## 6. 沙箱规则（C2 落地口径）

1. 任何字符串出现 `http://` / `https://` / `file://` → 拒绝。
2. 任何字符串含 `../` 路径跳出 → 拒绝。
3. `image` 层 `asset` 只允许 `@builtin/...` 或 `assets/...`（包内相对），字符白名单 `[a-zA-Z0-9/._{}-]`。
4. 表达式只允许第 4.3 节文法；`fmt` 的字面量禁止引号/反斜杠/换行。
5. 单模板 JSON ≤ 256 KB；包内资源总量 ≤ 20 MB、单张 ≤ 5 MB（模板包阶段执行）。

## 7. 验收约束

- 每套模板必须由 CLI 用固定测试照片真实渲染出样张（C6），禁止设计稿冒充。
- 新模板入库流程：JSON 过引擎校验 → CLI 渲染样张 → 样张进模板墙。
