# FrameGeist v1.4.0 记录

## 1. 为 12 枚镜头系列徽章各建一个模板：让它们第一次真正出现在成品里

### 1.1 问题（一个「资产存在但产品里看不见」的老问题）

v0.9.0 起就随徽标库一起交付了 12 枚镜头系列徽章（`series/`：sony-gm、sony-g、canon-l、
nikon-s、sigma-art、sigma-dgdn、sigma-apo、hasselblad-xcd、fujifilm-xf、zeiss-batis、
leica-apo、tamron-sp）。但 `templates/*.json` 里 **`@builtin/series/` 引用数为 0**：

- v1.2.0 修好的「墨迹居中」字标，只有在模板里被引用才会被用户看到；
- v1.3.0 做的 `-accent` 面（Nikon 官方黄），**只在引擎单测和 CLI 探针里成立**，
  在产品里没有任何渲染路径。

对照之下，6 枚游戏徽标早就各有 3 个模板（`game-<slug>-v1/v2/v3`），所以真正的缺口只在
series 这一组。**一个没人渲染的资产，只能通过它自己的门禁——这正是 accent 面「已实现、
已验证、却不可达」的原因。**

### 1.2 实现

12 个模板 `series-<slug>-01`（`meta.category: "camera"`，因为 `meta.category` 枚举里没有
`series`），版式**完全复用已被 18 个月视觉回归证明的 `game-honkai-v2` 角标几何**：

```
canvas   extend + #101418 + padding.bottom 0.26
layer    image @builtin/series/<slug>, size.height 0.06, anchor bottom-right,
         offset {x:-0.025, y:-0.055}, opacity 0.95
infoBlock  side bottom, align right, 1 行 detail: {focal}mm f/{aperture} {shutter} ISO{iso}
```

**不动任何既有模板** ⇒ 原有 192 个样片不可能漂移（VR 实测确认：384 → 408，只新增 24 项）。

**几何安全性先算后验**：徽标高度是相对照片高度的，所以最宽的 nikon-s（画布宽高比 4.57）
占照片高度的 0.06×4.57 = 0.274，对 4:3 画布相当于宽度的 0.21，远低于引擎 44% 的最大宽度
钳制；最窄的 canon-l（0.53）更小。实际量过的 12 个墨迹宽高比：0.53 / 0.86 / 1.72 / 1.76 /
1.93 / 2.04 / 2.74 / 2.83 / 2.83 / 3.65 / 4.04 / 4.57。

### 1.3 「accent 面在真实模板里上屏」的像素证据

因为仓库原本没有任何模板引用 series 徽标，v1.3.0 只能用合成模板 + CLI 探针证明 accent 面
可用。这一版用真实模板重证：

```
cargo run -p framegeist-cli -- render templates/assets/photos/showcase/series-nikon-s-01.jpg \
  --template templates/series-nikon-s-01.json -o out.png --format png
→ #FFE100 命中 187 px（容差 40 内 0.009% 画布）
```

exact 计数为 0 是因为徽标以 `opacity 0.95` 叠在深色带上（混合后 ≈ #F5D605，落在容差内），
这与 game 角标的行为一致。

### 1.4 目视复核（不只是门禁）

逐张看过 `series-nikon-s-01`（最宽，黄色 S-Line + 真实 EXIF 行）、`series-canon-l-01`
（最窄，白色 L）、并与既有 `game-honkai-v2` 对照观感权重：**三者的角标视觉重量一致**，
无裁切、无压字、无越界。

> 决策记录：**不裁剪系列资产到墨迹盒**。series 资产画布是 512 高但墨迹只占 112–161
> （墨迹高仅画布的 22–30%），裁剪后同样 `height: 0.06` 会让系列角标比游戏角标大 3–5 倍，
> 破坏设计语言统一。要改应该把 game + series 两组角标资产**一起**裁剪并重调 `size`，
> 作为独立一轮，而不是只动一组。

## 2. 新门禁：每个 series/game 徽标都必须被至少一个模板引用

`tools/check-brand-colors.mjs`（275 → **277 项**）：读取 `templates/*.json` 全文，
对 `MANIFEST.groups.series` 与 `.game` 的每个 slug 断言 `corpus.includes("@builtin/<kind>/<slug>")`。
brand 组豁免——模板通过 `{exif.brand_slug}` 占位符动态引用，不存在静态引用。

> 这条门禁是为了让 §1.1 那类故障**不可能再悄悄发生**：资产有、门禁过、但产品里没人渲染。

## 3. 配套的数据与断言

- **showcase 素材**：`tools/fetch-showcase-photos.mjs --extend --only=…` 为 12 个新模板分配
  12 张 Picsum 横构图照片（确定性种子，`showcase-map.json` 192 → 204 条）。
- **EXIF 注入**：`tools/prepare-showcase-exif.mjs` 给 204/204 照片注入真实 EXIF
  （portrait → sony-a7r3，landscape → nikon-z6ii / canon-r7 按模板 id 交替），
  并刷新 map 与 credits 的 sha256。
  **踩坑**：这一步不是可选的——新照片没 EXIF 时 `check-photo-uniqueness` 会以
  「every photo carries real EXIF」失败（`fields=0`），且信息行会退回 `framegeist` 占位文本。
  注入后必须**重渲样片**，因为信息行内容会从占位符变成真实镜头数据。
- **计数断言**：`e2e-audit.mjs` 的 4 处（wall / library / library / v0.7 typography）与
  `target/probe-desktop.mjs` 的 1 处由 192 改为 **204**；`check-photo-uniqueness` 用的是
  `>=192`，无需改动。
- **视觉基线**：384 → **408**（新增 24 项，既有 384 项未改写）。

## 4. 全量门禁（全绿）

- ✅ `validate-templates --all`：**204 ok / 0 failed**（192 + 12）
- ✅ `cargo fmt --all --check`；`cargo clippy --workspace --all-targets -- -D warnings`
- ✅ `cargo test --release --workspace`：全绿（首次跑出 `TEST_EXIT=101` 是 `target/release/framegeist.exe`
  被占用（os error 5）的文件锁，不是断言失败；清理进程后重跑即 0）
- ✅ 三 cross target：wasm32-unknown-unknown / aarch64-linux-android / aarch64-unknown-linux-ohos
- ✅ `tools/wasm-build.mjs`：`WASM_EXIT=0`，smoke **帧字节一致**、collage 在 PRD N2 像素门内
- ✅ JS 门禁：i18n **530/530**、品牌色 **277/277**、UI 对比度全过、字形 **204 模板 / 279 对 0 缺**、
  UTF-8 984 文件 0 破损、照片唯一性全绿
- ✅ 样片 `gen-samples`：**204 套 / 612 张，failed=0**
- ✅ 视觉基线：**408/408 全部在容差内（hamming ≤10，meanΔ ≤2.5）** ⇒ 既有 192 个模板**逐像素不变**
- ✅ **E2E 297/297**（真实 CDP 输入）
- ✅ **perf 4/4**：24MP 预览 283 ms / 导出 1014 ms；60MP 预览 466 ms / 导出 2487 ms
- ✅ 桌面端重建（4m04s，重新嵌入 1.4.0 web 资产）+ CDP 探针 **9/9**（版本 **1.4.0**、**204** 套模板、
  帧与识别框一致 1792×1560、真实点击选中、选中不改变视图、locate 拉回视口）

### 4.1 E2E 首跑的一次抖动（记录以免误判为回归）

首跑 `296/297`，唯一失败是 `runtime: no page exceptions/console errors`，详情是应用自身的首启
提示：`CONSOLE [fg] 首次启动初始化中，请稍候 … Error: 首次启动较慢（系统正在扫描应用文件）`。
当时机器正并发跑 cargo 与样片渲染。确认 `cargo=0`、无新 CLI 进程、CPU 27% 后在空闲机器复跑
⇒ **297/297 通过**，同一项 PASS。结论：负载相关的一次性抖动，非本版回归。

## 5. 发布记录

- 待补：commit / 远端 main / 标签 / 工作流 / 六资产哈希 / 说明注入 / Pages 验证。
