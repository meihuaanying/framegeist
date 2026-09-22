# FrameGeist v0.9.0 交接文档（新会话继续用）

> 生成时间：2026-09-22。执行契约：`docs/V0.9.0-CONSTRAINTS.md`（三轮 grill，24 项决策，勿擅自更改）。
> 仓库：`D:\FrameGeist`。所有命令在此目录执行。
> **一句话状态**：M0–M4 代码全部落地并各自自检通过；E2E **264/264**（run7，在新增 §81 之前）；§81 已写但完整全量运行被会话中断两次，**需要一次不中断的完整 E2E（预期 ≥270）**；M5 全量门禁收尾与 M6 文档/发布**未开始**。
> ⚠️ 最关键的收尾项：`target/release/framegeist.exe` 是**旧引擎**构建的（在「彩色保留阈值 3.0」与「图层字段优先」两处改动之前）；样片/基线/对比图都是用旧 CLI 生成的 → **必须先重建 CLI，再重渲样片 + 重生成基线 + 重出对比图**。

---

## 1. 环境配置

### 1.1 工具链（均可用）
| 工具 | 版本/说明 |
|---|---|
| Rust | 1.98.1 stable；targets：`x86_64-pc-windows-msvc`、`wasm32-unknown-unknown`、`aarch64-linux-android`、`aarch64-unknown-linux-ohos` |
| Node | v24.20.0；仓库 devDependency 仅 `@resvg/resvg-js` |
| Python | 3.12 + fontTools 4.54 + py7zr + brotli（字体管线，本次未用到） |
| wasm-bindgen | 0.2.128（必须与 crate 一致；`node tools/wasm-build.mjs` 已固化） |
| gh | 2.97.0，登录 `meihuaanying`（token scopes：gist/read:org/repo，**无 workflow**） |
| Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（Edg/153） |

### 1.2 本地服务（新会话需重启）
```powershell
# 静态服务 8350
Start-Process node -ArgumentList 'tools/serve.mjs','8350' -WorkingDirectory 'D:\FrameGeist'
# 无头 Edge（CDP 9237）
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList `
  '--headless=new','--disable-gpu','--remote-debugging-port=9237',`
  '--user-data-dir=C:\Users\Lenovo\AppData\Local\Temp\fg-edge4','--window-size=1440,900',`
  'http://localhost:8350/web/'
# 改了 web/ 后必须热重载（脚本在 temp）
node C:\Users\Lenovo\AppData\Local\Temp\opencode\reload-page.mjs
# 桌面端（v0.8 旧包仍在跑；v0.9 需重建，见 M6）
cargo build --release -p framegeist-desktop
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"; Start-Process "D:\FrameGeist\target\release\framegeist-desktop.exe"
```

### 1.3 网络/代理实况（本次实测）
- `github.com:443` 仍被阻断；`api.github.com` 可达（已用 Contents API 抓 simple-icons 数据）。
- **`raw.githubusercontent.com` 本次不可达（000）**；`cdn.simpleicons.org` 404；unpkg/jsDelivr 对该包 404。
  → 图标/数据一律走 `https://api.github.com/repos/simple-icons/simple-icons/contents/<path>?ref=develop` + `gh auth token` + `Accept: application/vnd.github.raw`（`tools/fetch-brand-colors.mjs`、`tools/gen-brand-assets.mjs` 已内置该路径 + 重试）。
- git 全局代理指向失效的 `http://127.0.0.1:7890`（历史遗留）；推送一律走 **Git Data API**（`tools/gh-api-push.mjs`）。

### 1.4 Shell 陷阱（血泪沿用）
- 工具 shell 时而 PowerShell、时而 bash：**避免 `&&`、`| head/tail`、内联 `node -e` 复杂转义**；复杂脚本写成临时 `.mjs` 再跑。
- 内联 `node -e "...\`...\`..."` 会被 PowerShell 吞掉反引号（本次踩过）→ 一律写文件。
- 禁止用 PowerShell `Set-Content/Out-File` 改写仓库文本；统一 Edit/Write 工具或 Node 脚本；发布前跑 `node tools/check-utf8.mjs`。
- 后台任务（`Start-Process`）在工具调用结束时可能被清理但通常能存活；用日志文件轮询确认。

---

## 2. 契约与决策摘要（详见 `docs/V0.9.0-CONSTRAINTS.md`）

- 徽标彩色：Simple Icons 官方 hex，**阈值规则**（`s≥0.18 且 0.10≤l≤0.90`）判定彩色品牌；主变体=官方色，新增 `-mono`，保留 `-light`；lockup 同品牌同色；series/game 单色。
- 对比保护：默认彩色；彩色对比 <3.0（WCAG 1.4.11 非文本对比）自动回退黑/白，仍不足加描边/底板；新增显式「官方彩色」（`tint/contrast: "color"`）。
- 徽标尺寸：引擎默认 **6.5%**、下限 **6%**、最大宽 **44%**；模板一次重跑（`version 1.3.0` 幂等），`minEngineVersion` 保持 0.7.0。
- 侧边栏：五 Tab（模板/照片/元素/画布/导出）+ 底部紧凑导出条（≤56px），**移除简单/高级 tier**。
- i18n：属性标签/图层名全中文；`check-i18n` 增加「属性标签必须是 i18n key」规则；E2E 扫描覆盖全部侧栏面板。
- 画布直操：点选（重叠再点循环穿透）+ 拖移 + 四角等比缩放 + 旋转（仅文本/形状）+ Delete/Backspace + 浮动工具条（删除/复制/置顶/置底/锁定）+ Shift 多选；手柄 10px 圆点 + ≥24px 隐形命中（粗指针 14/32）；空格/中键平移、缩放下拉、选中自动移入视野、画布尺寸指示。
- 徽标库：整库并入「添加元素」；移除独立徽标卡、墙顶入口与只读弹层；分组单选（全部+四组）+ 组内搜索 + 收藏/最近快捷行；图层级替换 + 「自动识别（EXIF）」。
- 徽标属性：默认写模板级 override；勾选「本图层单独覆盖」写图层字段（`corner/margin/size.height/contrast/opacity`，带备份与还原）。
- 交付：v0.9.0 完整发布（门禁 + 基线重生成 + 对比图 + API 推送 + tag/Release 六资产 + Pages + 桌面端）。

---

## 3. 已完成工作（M0–M4，全部自检通过）

### M0 — 资产与引擎颜色系统 ✅
- `tools/fetch-brand-colors.mjs`（新增）→ `tools/brand-colors.json` 锁定：**19 个官方图标（15 彩色 / 4 单色）**；Simple Icons 已移除 Canon/Hasselblad/Ricoh/Sigma/Zeiss/Tamron/Olympus/Pentax/GoPro/SanDisk/PhaseOne/Profoto/SmallRig → 这些品牌保持原创排版 mono（不臆造官方色）。
  - 彩色品牌：`nikon fujifilm leica panasonic epson insta360 samsung vivo oppo oneplus huawei google motorola nokia blackmagicdesign`
  - 单色（官方黑/白）：`sony(#FFFFFF) dji apple honor`
- `tools/gen-brand-assets.mjs` 重写：主变体（彩色/黑）+ `-mono` + `-light` + 三套 96px thumbs；`brand|lockup` 3 变体、`series|game` 2 变体；`web/brand/index.json` **v3**（每项含 `color`）；图标抓取走 API 路径。
- `tools/check-brand-colors.mjs`（新增）：内置极简 PNG 解码器（zlib+反滤波），做像素级校验（主变体饱和度/色相、mono 变体无饱和、文件矩阵齐全）→ **128/128 通过**。
- 引擎（`render.rs`/`template.rs`）：
  - 新 `ink_stats()`（亮度+饱和度）；彩色主变体在对比 ≥3.0 或被显式请求时保留，否则回退 `-mono`/`-light`；
  - `tint`/`contrast` 合法值新增 `"color"`（两处校验+override 校验）；
  - **图层字段优先**：`contrast`（layer > override）、`corner`（layer 优先且支持 `"anchor"` 哨兵强制锚点）、`opacity`（非 1.0 的显式值优先，否则 override）；
  - 尺寸默认 6.5% / 下限 6% / 最大宽 44%。
- `crates/framegeist-core/tests/engine_v070.rs`：旧断言改 v0.9 数值 + 新增 4 条颜色测试（保留彩色/低对比回退/强制彩色/暗底回退）→ **9/9 通过**。
- Web：`libThumb`/`markSlugVariant` 彩色缩略图（彩色品牌暗色主题仍彩色；mono 品牌暗色用 `-light`）。

### M1 — 尺寸提升 + 模板重跑 ✅
- `tools/apply-v090-typography.mjs`（新增，幂等标记 1.3.0）：徽标层 `height×1.3`（上限 0.12、下限 0.06、原 ≥0.10 保持；缺失→0.065），带「徽标越界/与文本重叠」守卫（基线对比，超限 1.3→1.15→1.0 回退）。
  - 结果：**192 套处理、191 个徽标层抬高、1 个回退、1 个冲突模板**；报告 `docs/reports/v0.9.0/typography-report.json`；模板 `meta.version=1.3.0`。
- `validate-templates --all` **192 ok / 0 failed**；`check-glyph-coverage` **355 对 0 缺失**；`gen-templates.mjs` 重建 web 镜像与 marks。
- 样片三档重渲 192/192（**注意：用的是未含最后两处引擎改动的旧 CLI，需重做**，见 §6）。
- 视觉基线 `--update` 384 项 + 复核全绿（同上，需重做一次）。
- 对比图 25 分类 / 150 组已生成到 `docs/reports/v0.9.0/compare/`，但**标签仍是 v0.6.1 / v0.7.0**（工具已加 `--before-label/--after-label`，需重出）。

### M2 — 侧边栏 Tab 重构 + i18n ✅
- HTML：新增 `.side-tabs`（5 Tab）+ `.side-panels`；卡片按 Tab 分组（模板：templateCard/layoutCard；照片：photo/exifEdit/exif；元素：insert/layers/props/watermark/tweak；画布：canvas/cardFx/frame/crop；导出：导出卡）；底部 `.export-bar`（渲染/导出/尺寸·格式摘要，点击进导出 Tab）；`#zoomSelect` + `#stageSize` 加入 stage head。
- 移除：`.actionbar`（261px sticky 遮挡根源）、`#tierToggle`、`#panelTierBtn`、所有 `advanced-only`、`#brandCard`、`#wallBrandLib`、`#brandLibModal`（含 JS 死代码）。
- CSS：`.sidebar` 改 grid（tabs/滚动面板/底栏）；`.side-tab/.side-panel/.export-bar/.insert-grid/.badge-lib-panel/.zoom-select/.stage-size`；`applyZoom` 设置 `--inv-zoom` 让手柄保持屏幕尺寸。
- i18n：`web/i18n.js` 新增约 105 键（含 `side.*`、`stage.*`、`layer.role.*`、`props.*` 全量标签、`opt.*` 选项）→ **485/485 对齐 0 失败**。
- `editor.js`：属性标签全部改 key（`propRow`/`addCheck` 显示 `t(label)`）；新增 `layerRoleName()/textRoleName()` 中文图层名（徽标·Canon / 机型 / 参数 / 日期…），原始 id/表达式放 title。
- `tools/check-i18n.mjs`：新增「`add*(grid, "<label>")` 必须是已存在 i18n key」规则。
- E2E §25 改为 Tab 断言（5 Tab、切面板、持久化、tier 不存在）。

### M3 — 画布直接操作 ✅
- 手柄重做：四角 `h-nw/ne/sw/se` + 旋转 `rot`（仅文本/形状），视觉 10px 圆点、命中 24×24（`pointer: coarse` 14/32），方位光标；旋转柄在顶边上方 26px；`touch-action:none`。
- 缩放：以「指针到盒中心距离」比例计算，写 `startSize × factor`（修复原实现逐帧叠乘的指数放大 bug）；语义：文本→字号、日历/形状/图片/色卡→等比尺寸。
- 旋转：写 text/shape 的 `rotation`（修复 `"rotation" in layer` 在 0 值缺键时失效的 bug）；15°/90° 吸附沿用。
- 点选：按住已选中图层拖动=移动该层；**单击（位移 <4px）在同点重叠图层间循环穿透**（pointerup 判定）。
- 浮动工具条 `.sel-toolbar`：删除/复制/置顶/置底/锁定（锁定态可防拖拽）；随选区显示，`--inv-zoom` 反缩放。
- 舞台：`#zoomSelect`（fit/50/75/100/150/200）、`#zoomFit`/`#zoomReset`、`#stageSize`（`W × H px`）；空白左键拖拽**不再平移**，平移改为空格/中键；`panIntoView()` 在选中与拖拽结束（250ms 后）自动把选区移入视野；`img.onload` 仅在 `autoFit` 时 fit（修复手动缩放被迟到的渲染重置）。
- E2E §80 覆盖上述全部 + 手柄命中区/自动移入视野。

### M4 — 徽标库并入添加元素 + 筛选修复 ✅
- `#insertCard` 增加 3 列 `insert-grid`（文字/图片/徽标/日历/分割线/线框/色卡，`#addBadge`）；`#badgeLibPanel`（风格/检测信息/作用图层/搜索/分组 chips/快捷行/网格/提示/自动识别/上传/清除）内嵌其中；预设选择移到卡片底部。
- 筛选修复：`renderBrandLibrary` 先按 `brandLibState.group`（`all`+四组）过滤再传 `renderLibGrid(grid, items)`；搜索在**当前分组内**；收藏/最近跨组快捷行；chip 显示计数。
- `constructor`：`#addBadge` → `insertBadge()`：无徽标层则新增 `@builtin/brand/<静态 slug 或 {exif.brand_slug}>` 图层（bottom-right、0.065）并选中；已有则选中第一个徽标层；随后展开库面板。
- 属性面板：选中徽标层时显示「显示徽标（全局）/ 本图层单独覆盖 / 位置 / 大小 / 对比保护（含官方彩色）/ 不透明度」；未勾选写模板级 override，勾选写图层字段并在 UI store 备份，取消勾选还原。
- 墙顶入口与弹层移除；墙卡片品牌标记改彩色变体。
- E2E §79 全部改为 v0.9 断言（manifest v3、彩色 hex、五 chips、分组过滤计数、组内搜索、插入/替换、自动恢复、偏好、墙入口不存在、卡片标记、骨架、content-visibility）；新增 §75b 图层级覆盖开关测试、§81 新断言组（穿透点击、锁定防拖、导出条镜像+跳 Tab、无徽标模板插入徽标层、暗色主题彩色缩略图、快捷行、空画布左键不平移）。

---

## 4. 门禁实测状态（截至本文档生成）

| 项 | 状态 | 备注 |
|---|---|---|
| `cargo fmt --all -- --check` | ✅（本次已 `cargo fmt` 修复后复检） | |
| `cargo test -p framegeist-core --release` | ✅ 全绿（含 engine_v070 9/9） | 全 workspace 未在本轮末尾重跑 |
| `clippy -D warnings` | ⚠️ 未在最后改动后重跑 | v0.9 期间曾通过；M5 需重跑 |
| 四 target / `cargo build --release -p framegeist-cli` | ⚠️ CLI 二进制**过旧**（缺最后两处引擎改动）；四 target 未跑 | M5 必做 |
| `node tools/wasm-build.mjs` | ✅ 曾在新引擎上通过（帧字节一致）；fmt 后建议重跑 | |
| `check-i18n` | ✅ 485/485，0 失败 | |
| `check-brand-colors` | ✅ 128/128 | |
| `check-utf8` | ✅ 913 文件 0 损坏 | 发布前再跑 |
| `check-glyph-coverage` | ✅ 355 对 0 缺失 | |
| `check-ui-contrast` | ⚠️ 未在 v0.9 重跑 | 样式有新增，M5 跑 |
| `validate-templates --all` | ✅ 192/192 | |
| 视觉基线 | ⚠️ 现有 384 项对应「旧 CLI 渲染的样片」 | 重建 CLI 后重渲+重生成 |
| 每分类对比图 | ⚠️ 已生成但标签错误（v0.6.1/v0.7.0） | 用 `--before-label v0.8.0 --after-label v0.9.0` 重出 |
| E2E | ⚠️ **264/264**（run7，§81 之前）；§81 加入后三次完整运行均被会话边界打断 | 需一次不中断全量，预期 ≥270 |
| `perf-audit` | ⚠️ 未跑 v0.9 | 目标 4/4 |

---

## 5. 未完成待办（按顺序）

### M5 — 全量门禁收尾
```powershell
cargo build --release -p framegeist-cli          # ← 必须先做（新引擎）
node tools/gen-samples.mjs --concurrency 6       # 576 张，完成标志 rendered=192 failed=0
node tools/visual-regression.mjs --update        # 基线重生成（记录原因：彩色+尺寸+对比阈值）
node tools/visual-regression.mjs                 # 复核全绿
node tools/make-compare-sheets.mjs --before .cache/v080-samples --out docs/reports/v0.9.0/compare --before-label v0.8.0 --after-label v0.9.0
cargo fmt --all -- --check
cargo test --release --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p framegeist-wasm --target wasm32-unknown-unknown --release
cargo build -p framegeist-core --release --target aarch64-linux-android
cargo build -p framegeist-core --release --target aarch64-unknown-linux-ohos
node tools/wasm-build.mjs
node tools/check-i18n.mjs; node tools/check-brand-colors.mjs; node tools/check-ui-contrast.mjs
node tools/check-glyph-coverage.mjs; node tools/check-utf8.mjs; node tools/validate-templates.mjs --all
# E2E（先确认 8350/9237 在跑 + 热重载；一次跑完，中途不要结束回合）
$env:FG_CDP_PORT="9237"; node tools/e2e-audit.mjs docs/reports/v0.9.0   # 预期 ≥270
FG_CDP_PORT=9237 node tools/perf-audit.mjs                               # 目标 4/4
```
人工审查：`docs/reports/v0.9.0/compare/` 抽 3-5 个分类（重点看徽标彩色与变大）、`brand/thumbs/nikon.png`（黄）与 `sony.png`（黑）。

### M6 — 文档与发布 v0.9.0
1. 版本四处：`Cargo.toml`(workspace) / `crates/framegeist-desktop/tauri.conf.json` / `web/app.js APP_VERSION` / `web/sw.js VERSION` → **0.9.0**。
2. 文档：`README.md`（彩色徽标/6.5%/五 Tab/直操画布）、`docs/CREDITS.md`（官方 hex 与彩色变体、阈值规则、-mono）、`docs/TEMPLATE-SPEC.md`（尺寸新默认 + `tint/contrast: color` + `corner: anchor`）、`docs/DESIGN-LANGUAGE.md`（徽标彩色/尺寸数值）、PRD Discoveries、`AGENTS.md` 状态、`docs/reports/v0.9.0/PROGRESS.md`（M0–M6）、`docs/releases/v0.9.0.md`（含商标声明）。
3. commit → **Git Data API 推送**：本地 diff 基准 = `36709c1`（当前 HEAD，v0.8 收尾 docs），远端 base = `ad09563`（v0.8 远端 main）；`node tools/gh-api-push.mjs <target> 36709c1 ad09563 main <msg-file>`（排除 workflow）；annotated tag `v0.9.0`（API）；Release 六资产（CI `release.yml` 自动；说明用 `gh release edit --notes-file docs/releases/v0.9.0.md` 注入）；Pages 200 验证（`/`、`/web/`、`APP_VERSION`、`sw` 缓存名、`brand/thumbs/nikon.png` 彩色）。
4. 桌面端 `cargo build --release -p framegeist-desktop` 并启动交付。

---

## 6. 本次会话关键文件改动（全部未提交）

| 类型 | 文件 |
|---|---|
| 新增 | `tools/fetch-brand-colors.mjs`、`tools/brand-colors.json`、`tools/check-brand-colors.mjs`、`tools/apply-v090-typography.mjs`、`docs/V0.9.0-CONSTRAINTS.md`、`docs/reports/v0.9.0/{compare/*,typography-report.json,00-editor.png…}` |
| 资产 | `templates/assets/{brand,lockup,series,game}/**`（三变体+thumbs）、`web/{brand,lockup,series,game}/**`、`web/brand/index.json`(v3)、`templates/assets/brand/CREDITS.json` |
| 引擎 | `crates/framegeist-core/src/render.rs`（ink_stats/彩色回退/3.0 阈值/precedence/6.5-6-44）、`src/template.rs`（color/anchor 合法值+校验）、`tests/engine_v070.rs`（9 测试） |
| 模板 | `templates/*.json`×192（version 1.3.0、徽标放大）、`web/templates.json`、`web/templates/*` |
| Web | `web/index.html`（Tab/插入卡+徽标库/导出卡+底栏/zoomSelect/stageSize；删 brandCard/wall入口/modal/actionbar/tier）、`web/styles.css`、`web/app.js`、`web/editor.js`、`web/i18n.js` |
| 工具 | `tools/gen-brand-assets.mjs`、`tools/gen-templates.mjs`、`tools/check-i18n.mjs`（标签 key 规则）、`tools/e2e-audit.mjs`（§25/§75/§75b/§79/§80/§81 重写/新增）、`tools/make-compare-sheets.mjs`（标签参数） |
| 其他 | `tools/wasm-build.mjs`（未改，但重跑产物 `web/pkg/framegeist_wasm_bg.wasm` 已更新）、`tools/visual-baselines.json`（旧 CLI 基线，待重生成） |

临时辅助脚本（`C:\Users\Lenovo\AppData\Local\Temp\opencode\`，可能被清理）：
`reload-page.mjs`（热重载）、`editor-probe.mjs`、`m3-probe*.mjs`、`m4-probe.mjs`、`labels-probe.mjs`、`scale-probe.mjs`、`rot-probe.mjs`、`zoom-probe.mjs`、`sidebar-probe.mjs`。

---

## 7. 已知问题 / 风险 / 注意事项

1. **CLI 过旧**：`render.rs` 最后两处改动（3.0 彩色阈值、图层优先级）之后只重建了 wasm，**没有重建 CLI**。因此现有样片/基线/对比图都不是最终像素；M5 先重建 CLI 再重做三件事（重渲/基线/对比图），否则发布产物与测试基线不一致。
2. **E2E 必须一次跑完**：本会话最后三次全量 E2E 均在 ~50–60% 处被「回合结束」打断（4090 行日志只写一半）；新会话务必在一条命令里跑完（约 5 分钟），不要中途结束回合。若 9237 掉线或出现多页面目标，按 v0.8 HANDOFF §1.2 重启无头 Edge。
3. E2E 新交互步骤已改为**轮询等待手柄出现**（`waitHandle`，最多 8s）而不是固定 sleep——24MP 重渲期间手柄会短暂消失，不要改回固定等待。
4. E2E 的彩色断言用 `nikon`（彩色）与 `sony`（单色）；若 Simple Icons 未来下架 Nikon，需换一个彩色品牌并同步 `brand-colors.json`。
5. 图层级覆盖的实现口径（写图层字段 + UI 备份还原；`corner:"anchor"` 哨兵；opacity 显式非 1.0 优先；**size 仍会叠加模板级 brandScale**）已在契约 §3.6 记录，如果要改语义需同步引擎。
6. 旋转手柄仅文本/形状（图片无 rotation 字段，Q13 决策）；不要给图片加旋转手柄。
7. `docs/reports/v0.9.0/compare/` 现有 25 张图标签错误，重出时务必带 `--before-label/--after-label`。
8. 发布铁律：不改 `.github/workflows/*`（token 无 workflow scope）；推送走 `tools/gh-api-push.mjs`，成功后清理工作区可能残留的缓存（本实现缓存在系统 temp，不污染仓库）。
9. 工作区有 1299 项未提交改动；新会话开工前先 `git status` 确认，不要误 `git add` 临时文件（temp 目录不在仓库内，安全）。
10. 远端 main = `ad09563`；本地 HEAD = `36709c1`（与远端树一致，仅 workflow notes-file 差异未上远端）。**别用 `git push`**（github.com 被阻断）。

---

## 8. 常用速查

- 预览：`node tools/serve.mjs 8350`；页面热重载：`node <temp>\reload-page.mjs`。
- E2E：`$env:FG_CDP_PORT="9237"; node tools/e2e-audit.mjs docs/reports/v0.9.0`（截图归档到报告目录）。
- 样片：`node tools/gen-samples.mjs --concurrency 6`；基线：`node tools/visual-regression.mjs [--update]`。
- 资产：`node tools/fetch-brand-colors.mjs`（重锁 hex）、`node tools/gen-brand-assets.mjs`、`node tools/check-brand-colors.mjs`。
- 排版：`node tools/apply-v090-typography.mjs [--dry|--force]`（--force 前先 `git checkout -- templates` 防叠乘）。
- 对比图：`node tools/make-compare-sheets.mjs --before .cache/v080-samples --out docs/reports/v0.9.0/compare --before-label v0.8.0 --after-label v0.9.0`。
- 推送：`node tools/gh-api-push.mjs <target> 36709c1 ad09563 main <msg-file>`。
- 端口：预览 8350；E2E CDP 9237；桌面 CDP 9333；8101–8200 为 Windows 排除端口勿用。

---

## 9. 新会话起手指令（建议直接贴给新对话）

> 仓库 `D:\FrameGeist`。先读 `AGENTS.md`、`docs/V0.9.0-CONSTRAINTS.md`、`docs/reports/v0.9.0/HANDOFF.md`（本文档），然后按 §5 继续：
> ① `cargo build --release -p framegeist-cli`（必须，新引擎）→ ② 重渲样片 + 重生成基线 + 重出对比图（带正确标签）
> ③ 跑完 M5 全量门禁（fmt/test/clippy/四 target/wasm/各 check）
> ④ 一次不中断地跑完整 E2E（预期 ≥270；section 25/75/75b/79/80/81 是 v0.9 新断言）与 perf 4/4
> ⑤ M6：版本四处 0.9.0 + README/CREDITS/TEMPLATE-SPEC/DESIGN-LANGUAGE/PRD/AGENTS/PROGRESS/release notes
> ⑥ commit → Git Data API 推送（local-base 36709c1 / remote-base ad09563）→ tag v0.9.0 → Release 六资产 → Pages 验证 → 桌面端重建交付。
> 铁律：不改 `.github/workflows/*`；不用 PowerShell 改写含非 ASCII 文件；发布前 `check-utf8`；E2E 中途不要结束回合。
