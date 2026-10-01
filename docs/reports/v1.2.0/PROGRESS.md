# FrameGeist v1.2.0 进度记录

## 1. 素材可得性考证（侦察子代理 + 复核）

用户指令：「先补齐 12 枚系列徽章 / 6 个游戏字标的官方素材再一次性落地」，并选择方案 **B**。

### 1.1 计数校正

v1.1.0 按裁决 6 移除 `canon-rf-l` 后，`web/brand/index.json` 的 `groups.series` 实为 **12 枚**（不是 13）；
已落地 `nikon-s`，**待补 11 枚**；加 6 个游戏字标 → **待补 17 项**。

### 1.2 逐项取证结论

产出 `docs/reports/v1.2.0/series-game-materials.md`（346 行）。建议动作分类：

| 分类 | 数量 | 项目 |
|---|---|---|
| `ingest-official` | 4 | `zzz` / `honkai` / `wwmeet` / `wukong`（唯一可靠渠道 = Steam 商店 API） |
| `keep-mono` | 13 | 11 枚系列徽章 + `genshin` + `arknights` |
| `recolour-with-accent` | **0** | 没有任何一项能从官方页面取到可套色的点缀色 |

### 1.3 硬证据（拒绝臆造）

- **Sigma ART 是纯 HTML 文字**：产品页 `<h2 class="f-h2…"><p class="first-child">ART</p>…</h2>`，
  页内 `<svg>` 标签数 = 0、`background-image:url()` 数 = 0 → 官方根本没有图形标识；
- **Tamron**：`sprite.svg` 86,610 字节 / 81 个 `<symbol>`，唯一含 `logo` 的是母品牌，**无 SP**；
  SP 页 28 张图全是生活化场景缩略图；
- **HoYoverse 对 genshin/zzz/honkai 零素材**：4 个 `_nuxt/*.js`（1,055,178 字节）+ 官方 `footer.js`
  （81,485 字节）图片引用数全部为 0，官网 CSS 也无 logo 填充色；Steam 无原神条目，Epic 商店页 403；
- **favicon 取色不可用**：zzz `#F2850E` / honkai `#FFC62C` 经占比检验**仅占 0.2% 不透明像素，属抗锯齿噪声**；
- **Arknights 官网字标就是字体拼排**：CSS 15 个 `url()` 全是字体（`Oswald-Bold.ttf` 等），
  而仓库已持有 OFL 的 `Oswald-400~700.ttf` → **用 Oswald 排印 = 与官方网页字标同源**（最有价值的发现）；
- 受限项如实标注为「不可达」而非「不存在」：`sony.com` 403、`fujifilm-x.com` 403 Cloudflare、
  `arknights.com` / `wwmeet.cn` / `heismodegame.com` DNS ENOTFOUND、Zeiss 镜头路径全 404。

### 1.4 方案 B 的落地内容

1. 11 枚系列徽章：**维持官方单色**（官方本就无彩色标识），不臆造颜色、不用低分辨率图充数；
2. 6 个游戏字标：沿用**原创排印**（v1.0.0 裁决 7 的兜底口径），其中 ARKNIGHTS 用的 Oswald 600
   正好与官方网页字标同源；
3. `canon-l` 的历史记录更正：徽章是**黑色**（实测 ink 全黑 3,124 像素），`manifest` 中 `color` 保持 `null`，
   v1.1.0 文档里「Canon L 配官方红」的说法已在 `docs/CREDITS.md` 更正；
4. 把「素材到位就能上色」的引擎能力与门禁补齐（见 §2、§3）。

## 2. 引擎：官方点缀色面 `-accent`

### 2.1 问题

系列徽章在仓库里一直是单色资产，引擎彩色分支要求主资产自身带色
（`render.rs` 的 `primary_colorful = chroma >= 0.25`），所以 manifest 里的官方点缀色永远到不了画面
——v1.1.0 遗留的已知落差（`nikon-s.accent = #FFE100` 只是元数据）。

### 2.2 实现

`crates/framegeist-core/src/render.rs`：

- 抽出**纯策略函数**
  `pub fn pick_badge_face(mode, tint_hint, primary_colorful, scores, available, want_light) -> BadgeFace`；
- 新增 `pub enum BadgeFace { Primary, Accent, Mono, Light }`、`pub struct BadgeScores`、
  `pub struct BadgeAvailability`、`pub const BADGE_COLOR_FLOOR: f32 = 3.0`；
- 渲染路径加载可选的 `<base_path>-accent.png`，仅在 **过 1.4.11 的 3:1 底线**或图层显式
  `tint: "color"` / `contrast: "color"` 时使用，否则回退黑/白变体；
- accent 面是**纯上色**，几何与 mono 面逐像素一致 → **排版零位移**；
- 没有 `-accent` 文件时行为与 v0.9 完全一致；pre-v0.9 单面资产集仍回退主资产。

### 2.3 测试 `crates/framegeist-cli/tests/engine_v120.rs`（4/4）

| 用例 | 断言 |
|---|---|
| `accent_face_policy` | 决策表全枚举：彩色主资产保持旧行为、accent 达标→Accent、不达标→Mono/Light、显式 color→Accent、无 accent 文件→Mono、单面资产→Primary |
| `accent_face_follows_local_contrast` | 黄标（1.2:1 对白底）暗底上屏、白底回退黑标、白底无黄像素 |
| `strong_accent_survives_light_background` | 红色 accent（对白底 >3:1）白底也上屏 |
| `accent_face_keeps_mono_geometry` | accent 与 mono 的墨迹盒逐像素相同（几何不变） |

测试用 `RenderOptions.assets` 内存资产图注入合成徽章，**不需要磁盘 fixture**。

## 3. 字标墨迹居中（真实缺陷修复）

### 3.1 现象与根因

`tools/gen-brand-assets.mjs` 用 `dominant-baseline="central"` 排版，**居中的是 em 盒而不是墨迹**；
遇到升降部不对称的字体就偏心。`target/png-dims.mjs` 实测：

| 资产 | 修正前 padY | 修正后 padY | 修正前 padX | 修正后 padX |
|---|---|---|---|---|
| `game/wwmeet` | 113 / 96 | 105 / 104 | 103 / 121 | 112 / 112 |
| `game/arknights` | 177 / 156 | 167 / 166 | 129 / 130 | 130 / 129 |
| `game/wukong` | 176 / 156 | 167 / 165 | 48 / 53 | 51 / 50 |
| `series/leica-apo` | 172 / 181 | 177 / 176 | 64 / 76 | 70 / 70 |
| `series/canon-l` | 174 / 183 | 179 / 178 | 46 / 46 | 46 / 45 |

未重渲的其余字标也有水平偏心（`fujifilm-xf` 20/26、`hasselblad-xcd` 6/11、`sigma-apo` 2/7、
`zeiss-batis` 83/76、`genshin` 30/22、`sigma-art` 14/12、`tamron-sp` 20/18）→ **一次性重渲全部 17 项**
（`--only` 模式显式列出 slug，**排除官方素材 `nikon-s`**，且 `--only` 不写 manifest/CREDITS）。

### 3.2 实现

`inkOffset(entry, width, fontSize)`：先渲染一次量墨迹包围盒，再把文字坐标偏移到墨迹居中，结果按 slug 缓存；
拆出 `wordmarkSvgRaw()` 供探测与最终输出共用。

### 3.3 踩坑：`@resvg/resvg-js` 惰性 `pixels` 会静默杀进程

`RenderedImage.pixels` **在循环里惰性读取会让 node 直接退出（exit 1、无任何报错）**，
一度被误判为字体缺失或资源问题。修法：先 `Uint8Array.from(probe.pixels)` 复制一次再扫描。
定位工具 `target/probe-wordmark.mjs`（分步打印 step1..step4）。
> 纪律补充：**无输出的崩溃要立刻用分步探针定位**，不要靠猜。

### 3.4 事故：`@resvg/resvg-js` 原生内存不归还 → 整机内存耗尽（2026-10-02）

**现象**：多次「系统内存不足」+ 蓝屏（0x3B / 0x116 / 0x7E）；Windows 内存诊断记录
`node.exe` 提交内存 **137,717,194,752 B ≈ 128 GB**，时间点与一次
`gen-brand-assets.mjs --only …` 完全吻合。完整报告：`docs/reports/v1.2.0/incident-resvg-leak.md`。

**根因**：`Resvg.prototype` 只有 `constructor`（**无 free/dispose**），`RenderedImage` 只有
`asPng/height/pixels/width` → 每次 `new Resvg(...)` 重新解析字体并在 Rust 侧分配
fontdb/usvg tree，**只有进程退出才归还 OS**，`global.gc()` 无效。
实测（`target/probe-resvg-mem.mjs`，40 次 512×512 渲染 + `--expose-gc`）：RSS 94 MB → 140 MB
（**≈ 1.2 MB / 次渲染**）。一次全库生成约 500+ 次渲染 → 与 128 GB 量级一致。

**修复：按资产子进程隔离**（只改进程边界，不改任何渲染参数）

| 工具 | 隔离前渲染次数 | 隔离后 |
|---|---|---|
| `tools/gen-brand-assets.mjs` | ~500+（单进程累加） | 每资产 1 个子进程，`--render-one <kind> <slug>`（+ `--svg-file` 传官方 SVG） |
| `tools/import-brand-inbox.mjs` | 22 品牌 × ~4 次（单进程累加） | 每品牌 1 个子进程，`--render-one <slug>` |
| `tools/make-compare-sheets.mjs` | 25 张合成图（单进程累加） | 每分类 1 个子进程，`--render-one <category>` |

- 子进程成功时打印机器可读标记 `RENDER_OK …`，父进程解析后重建 `iconSlugs` / `iconCredits` /
  `wordCredits` / `lockupCredits` / 报告条目；
- **manifest 与 `CREDITS.json` / `brand-colors.json` 的写入仍只在父进程**（子模式跳过），
  「渲染被隔离、语义不变」；
- 子进程统一带 `--max-old-space-size=1024` 兜住 JS 侧意外增长；
- 父进程 `stdio: ["ignore","pipe","inherit"]`，子进程日志原样回显。

**字节等价验证**（隔离后必须与隔离前完全一致，否则资产/样片/基线全部作废）：

- `gen-brand-assets --only canon-l,wwmeet,arknights` → 5 个文件 SHA256 **全部 SAME**；
- `import-brand-inbox --only zeiss` → `templates/assets/brand/zeiss.png` **IDENTICAL**，
  `--dry` 仍零写入（`git status` 0 行）；
- `make-compare-sheets` 完整 25 类 → `game.png` **IDENTICAL**，输出仍
  `25 categories, 150 before/after pairs`；
- 内存采样（6 个 slug 连续渲染，同时刻所有 node 进程驻留内存峰值）**167 MB**（父 + 1 子进程）。

> 纪律补充：**任何批量渲染工具都必须走子进程**（resvg 无释放接口是上游限制）；
> 且这类长命令一律 `background: true` + 日志，避免会话中断留下半写状态（工具均幂等覆盖，重跑即可）。

## 4. 门禁变化

`tools/check-brand-colors.mjs` 从 **250 → 268 项**（新增 18 项 `ink is centred in its canvas`：
12 枚系列 + 6 枚游戏，容差 2px）。现在同时守住：颜色口径（manifest v5 / `originalColorOverride` / `officialAsset`）、
宽字标墨迹高度 ≤ 0.34×画布高（v1.1.0 回归护栏）、字标墨迹居中 ≤ 2px（v1.2.0 新增）。

## 5. 资产重生成与验证

- `gen-samples`：**192 套 / 576 张，failed=0**；
- `visual-regression --update`：**384 项基线更新**；
- `extract-before-samples`：`git show HEAD:templates/previews/*` → v1.1.0 侧 192 张；
- `make-compare-sheets --before-label v1.1.0 --after-label v1.2.0`：**25 类 / 150 组**；
- 对比图目视（game 类）：`game-arknights-v1` / `game-wukong-v1` / `game-zzz-v3` 版式与 v1.1.0 一致，
  字标位置微调居中，**无裁切、无压字**。

## 6. 全量门禁（全绿）

- ✅ `validate-templates --all`：192 ok / 0 failed
- ✅ `cargo fmt --all --check`
- ✅ `cargo clippy --workspace --all-targets -- -D warnings`（修掉测试里两处 `manual Range::contains`）
- ✅ `cargo test --release --workspace`：17 个套件全 `ok.`，含新增 `engine_v120` 4/4
- ✅ 三 cross target：`wasm32-unknown-unknown` / `aarch64-linux-android` / `aarch64-unknown-linux-ohos` 全 0
- ✅ `node tools/wasm-build.mjs`：WASM_EXIT=0，smoke **帧字节一致**（并发污染 `web/pkg` 导致的那次失败已用单独重跑排除）
- ✅ JS：i18n 524/524、字形 192 套 279 对 0 缺、UTF-8 953 文件 0 破损、UI 对比度全过、照片唯一性全过、品牌色 **268/268**
- ✅ 样片 `gen-samples` 192 套 576 张、视觉基线 384 项、对比图 25 类 150 组（v1.1.0 → v1.2.0，已逐类目视）
- ✅ E2E **287/287**（真实 CDP 输入，`target/e2e-v120.log`）
- ✅ perf **4/4**：24MP 预览 508 ms / 导出 977 ms；60MP 预览 519 ms / 导出 2323 ms（`target/perf-v120.log`）
- ✅ 桌面端 `cargo build --release -p framegeist-desktop`（3m32s，重新嵌入 1.2.0 web 资产）+ CDP 探针 **9/9**（版本 1.2.0、192 套模板、渲染帧与识别框一致 1792×1560、真实点击选中、选中不改变视图、locate 拉回视口）
- ✅ 版本号四处 1.2.0（`web/app.js:9`、`web/sw.js:6`、`Cargo.toml:6`、`tauri.conf.json:4`，桌面探针断言同步改 1.2.0）

## 7. v1.2.0 口径小结

这一版的价值不在「换一批图」，而在于把两件事做对：

1. **不臆造官方素材**：官方没发布就不发布，`recolour-with-accent = 0` 是取证结论而非偷懒；
2. **素材到位即可上色**：引擎 `-accent` 面 + 门禁就位，将来你给出官方彩色系列徽章，
   一次 `import-brand-inbox --accent` 即可全部上屏，且不会破坏排版。

## 8. 发布记录（v1.2.0）

- 本地提交 `3e19ca9`（parent `7550c62` = v1.1.0 收尾提交），工作树干净。
- Git Data API 推送：remote-base `943703f2` → 远端 `main` = **`c5a7a5dea4bc5630adaed8b2e118066d9f9863d1`**。
- 标签 `v1.2.0` → **`c5a7a5d`**。
  ⚠️ **本版是轻量标签（lightweight）**：注解标签的 `POST /git/tags` 接口在本机被 GitHub 以
  422 拒绝（`For 'properties/object', … is not a string / "type" wasn't supplied`），
  请求体已用 `gh api --verbose` 自证是合法 JSON（`{"tag","message","object":{"sha","type"}}`），
  `gh --input` / `--input -` / `-f object[sha]` / `-f object[type]` 四种写法均被同样拒绝，
  属服务端参数校验异常；`POST /git/refs`（单层参数）正常，故退回轻量标签。
  影响范围仅限标签对象类型：`ref_name` 仍为 `v1.2.0`，Release 工作流与产物完全一致，
  版本说明改由 `docs/releases/v1.2.0.md` 注入。后续版本若需注解标签，可在 GitHub UI 端补。
- 触发的工作流：main push → ci `36903723616` ✅ / pages `36903723806` ✅；tag push → ci `36903932187` ✅ / release `36903932562` ✅（**四个全部 success**）。
- Release：https://github.com/meihuaanying/framegeist/releases/tag/v1.2.0 ，六资产与哈希

  | 资产 | 字节 | sha256 |
  | --- | --- | --- |
  | `framegeist-cli-v1.2.0-win-x64.zip` | 77,503,262 | `d0c54ae7fc138e26e52ff7273affc84c51122f609c16ca0cb69ab1b23c182b2a` |
  | `framegeist-desktop-v1.2.0-win-x64.zip` | 101,355,892 | `4ffdd3a73fbe6faf76ba88adb6462fe3300fb80ccac11371ed753ce900e358b6` |
  | `FrameGeist-v1.2.0-win-x64-setup.exe` | 101,337,737 | `7cc53fcafe312fea96e197245a7cde44efe3ad36ba97bd264a3ede5c06269b2a` |
  | `framegeist-templates-v1.2.0.fgpkg` | 20,674,803 | `9e8e9e5ce0173fa6e5c26ed90f9c09114328691c407b337c84f2868ad0cfa5f3` |
  | `SHA256SUMS.txt` / `update.json` | 406 / 1350 | — |

  **SHA256SUMS.txt ↔ update.json 四项哈希与体积逐一相符** ✅（update.json `schemaVersion 1` / `channel stable` / `generatedAt 2026-10-01T18:27:21Z` / `templates.count 192`）。
- Release 说明：工作流只写了自动 changelog → `gh release edit v1.2.0 --notes-file docs/releases/v1.2.0.md` → body **5827 字符** ✅。
- Pages 验证：线上 `APP_VERSION = "1.2.0"`、`sw.js` 缓存名 `framegeist-1.2.0`、`web/brand/index.json` = manifest v5（series 12 枚、`nikon-s.accent = #FFE100`）✅。
