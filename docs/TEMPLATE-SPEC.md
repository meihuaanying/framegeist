# FrameGeist 模板规格（TEMPLATE-SPEC）

> 版本 v0.1 ｜ 对应引擎 `framegeist-core` v0.1.x ｜ 机器可读 schema：`docs/schema/template.schema.json`
> 模板是**声明式 JSON**（C1），不可执行代码、不可联网、不可读包外路径（C2）。本文件是模板语言唯一的语义来源；引擎内置校验器按本规格执行，JSON Schema 文件是同规格的机器可读对照。

## 1. 文件与尺寸限制

| 项 | 限制 |
|---|---|
| 模板 JSON 体积 | ≤ 256 KB（`MAX_TEMPLATE_JSON_BYTES`） |
| 字段表达式长度 | ≤ 512 字符 |
| `fallback` 文本 | ≤ 256 字符 |
| `content` 条目数 | 1–64 |
| `font.family` 条目数 | 1–8，每项 1–64 字符 |
| `layers[].id` | 1–64 字符，`[a-zA-Z0-9-]` |
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
| `category` | 枚举 8 分类：`classic-white / film / polaroid / gallery / technical / magazine / minimal / frame-shell` |

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
| `image` | 骨架阶段回退为直接铺照片；v1.x 支持指定包内图片 |
| `none` | 不处理背景（透明/保留照片） |

### 3.4 `radius` / `shadow`

结构已定义（圆角 0–512px、阴影 blur/opacity/offsetX/offsetY），骨架阶段渲染器忽略；黄金图不含这两项效果，启用前会变更基线。

## 4. `layers[]`

`type` 目前支持 `text` 与 `image`（`image` 的资产渲染在模板包阶段实现 E1，引擎当前跳过该层）。

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
- `color`：`#RRGGBB[A]`
- `weight`：结构保留（100–900），骨架阶段单字重文件忽略

### 4.3 `content[]` 与字段表达式（C3）

白名单文法（引擎 `sandbox.rs` 单一实现，五端共享）：

| 形式 | 求值 |
|---|---|
| `exif.<key>` | 直接取字段，见下表 |
| `'<literal>'` | 常量文本（C3） |
| `fmt('<literal>', exif)` | `{key}` 占位替换；**任一 key 缺失 → 整条为 None**（走 `fallback`） |
| `if_empty(exif.<key>, '<literal>')` | 值为空/缺失时取字面量 |
| `date('<format>', exif.datetime)` | EXIF 日期（`YYYY:MM:DD HH:MM:SS`）重排，token：`YYYY MM DD HH mm SS` |

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

### 4.4 行高

`lineHeight`（默认 1.3，[0.5, 4]）：行间距 = `size_px * lineHeight`；多行文本总高 = `(n-1) * lineH + lastLineH`。

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
