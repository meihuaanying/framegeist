# FrameGeist v0.5.0 会话交接文档（HANDOFF — 新会话从这里开始）

> 生成时间：2026-09-15 ｜ 项目：`D:\DSH`（Rust workspace + Web/WASM + Tauri 桌面）
> 契约：`docs/V0.5.0-CONSTRAINTS.md`（强制）＋ `AGENTS.md`（工程铁律）
> 进度：`docs/reports/v0.5.0/PROGRESS.md`（M0–M4 已写入）
> 一句话现状：**M1–M4 已完成并过门禁（E2E 79/79）；M5 自由拼图「引擎+wasm 已完成、UI 刚写完尚未做浏览器验证」；M6–M8 未完成。**

---

## 1. 环境与工具链（实测可用）

| 项 | 值/命令 |
|---|---|
| 项目根 | `D:\DSH`（**不是** `C:\Users\Lenovo\Documents\Default Project`） |
| Rust | 1.98.1；四 target 已装：`x86_64-pc-windows-msvc`、`wasm32-unknown-unknown`、`aarch64-linux-android`、`aarch64-unknown-linux-ohos` |
| Node | v24.20.0；`@resvg/resvg-js` 已是 devDependency |
| wasm-bindgen-cli | **0.2.128**（必须与 crate 版本严格一致） |
| 本机 Edge（E2E 用） | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（headless=new + CDP） |
| 静态服务器 | `node tools/serve.mjs 8123`（本次会话一直在 8123 上跑；`http://localhost:8123/web/`） |
| git | 工作区有大量未提交改动（见 §7）；未 push |
| 网络 | Picsum 可达；crates.io 可达；GitHub 代理不稳（push 用 `git -c "http://.proxy=" ...` 或重试） |

### 常用命令（复制即用）

```powershell
# 引擎/全部测试 + 静态检查（提交前铁律）
cargo test --release --workspace
cargo clippy --workspace --all-targets -- -D warnings

# 只跑 v0.5 引擎回归（15 项：字效/组/日历/裁切/元数据/Fuji/自由拼图/双引擎）
cargo test -p framegeist-cli --test engine_v050

# 重建 CLI（tools/validate-templates、gen-samples 依赖 release CLI）
cargo build --release -p framegeist-cli

# 重建 wasm（**改动 core/wasm 后必须重跑这两条**，否则 web 用旧 schema）
cargo build -p framegeist-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --out-dir web/pkg --target web target/wasm32-unknown-unknown/release/framegeist_wasm.wasm

# 跨端一致性门禁（WASM↔CLI 帧字节一致 + 拼图像素差 ≤0.001）
node tools/wasm-smoke.mjs

# 照片唯一化管线（已跑完；新模板时用 --extend 只补缺失）
node tools/fetch-showcase-photos.mjs --extend
node tools/check-photo-uniqueness.mjs

# 全量样张重渲（192×3，约 3 分钟，产物 templates/{samples,previews,thumbs} + web 镜像）
node tools/gen-samples.mjs

# 模板校验（单文件或 --all）
node tools/validate-templates.mjs templates/art-gilt-foil.json --photo templates/assets/test-photos/sample-landscape.jpg

# 模板 manifest/web 镜像（加了模板后必跑）
node tools/gen-templates.mjs
```

### E2E（浏览器版，本会话新增）

```bash
# 1) 起静态服务（若未在跑）
node tools/serve.mjs 8123 &

# 2) 起 headless Edge（CDP 端口自定；E2E 读取 FG_CDP_PORT，默认 9223）
rm -rf "$TEMP/fg-edge"  # 干净 profile
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --headless=new --disable-gpu --remote-debugging-port=9237 \
  --user-data-dir="C:\Users\Lenovo\AppData\Local\Temp\fg-edge" \
  "http://localhost:8123/web/" &

# 3) 跑审计（截图输出到 docs/reports/v0.5.0）
FG_CDP_PORT=9237 node tools/e2e-audit.mjs docs/reports/v0.5.0
# 上一轮结果：=== E2E audit: 79/79 passed ===（门禁 ≥70）
```

- 审计脚本已内置：CDP 目标选择（忽略 Edge 同步弹窗）、`Network.setCacheDisabled` + 绕过 SW、warm reload、8 分钟 watchdog、`ev` 30s 超时、控制台错误打印。
- **Tauri 真机流程不变**：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` 启动 exe 后 `node tools/e2e-audit.mjs`。

---

## 2. 里程碑状态

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 cosmic-text wasm spike | ✅ | 契约原有 |
| M1 照片唯一化 | ✅ | 192/192 唯一，门禁全绿（`check-photo-uniqueness.mjs`） |
| M2 引擎（字效/图层/日历/Fuji/导出） | ✅ | engine_v050 15 项、wasm 字节一致；黄金基线已按新渲染器**全量重生成** |
| M3 编辑器 UI（图层/直操/吸附/撤销/双模面板） | ✅ | `web/editor.js` + index/styles/i18n；E2E 新增 15 条断言 |
| M4 背景/相框/画幅/卡片/裁切（含空白检测） | ✅ | `canvas.frame` + 裁切 overlay + 720P + metadata 开关 |
| M5 日历 + 相框制作 + 自由拼图 | 🟡 | 日历 ✅、相框制作 ✅；**自由拼图：引擎/wasm/Rust 测试 ✅，UI 刚写完未验证** |
| M6 8 款艺术模板 + 全部模板接入与审计 | 🟡 | 8 款 art-*.json ✅（validate 8/8、逐张目视）；**“192 套接入新能力 + 接触表审计”未做** |
| M7 全量门禁 | 🟡 | core/CLI 测试 ✅、clippy ✅、wasm smoke ✅、E2E 79/79 ✅；**四 target 构建、性能复测未跑** |
| M8 文档 + 报告 + 发布 | ❌ | TEMPLATE-SPEC/schema/AUTHORING/DESIGN-LANGUAGE 已更新；版本号、PARITY、报告、Release/Pages 未做 |

---

## 3. 本会话新增/大改文件（新会话重点）

### 引擎（Rust）

| 文件 | 内容 |
|---|---|
| `crates/framegeist-core/src/text_shape.rs`（新） | cosmic-text 0.19 + swash 整形/掩膜；`Shaper::{new,shape,has_fonts}`；空字体库安全返回 None |
| `crates/framegeist-core/src/text_art.rs`（新） | 字效矩阵（描边/双线/浮雕/阴刻/压印/内阴影/渐变/烫金/纹理/阴影/flip/scaleX）＋`draw_solid_text`（日历用） |
| `crates/framegeist-core/src/calendar.rs`（新） | 农历 1900–2100 查表 + 月历/大日子/条带视图；5 项单测 |
| `crates/framegeist-core/src/boxes.rs`（新） | `layer_boxes_json` / `layer_boxes_for_photo`（编辑器命中/吸附） |
| `crates/framegeist-core/src/free_collage.rs`（新） | `FreeSpec/FreeItem` + `load_free_spec` + `render_free_collage`（x/y 中心归一化、w/h、rotation、z、radius、border、crop、opacity） |
| `crates/framegeist-core/src/template.rs` | v0.5 schema：`TextEffects`、`group`/`calendar` 层、shape `double/gap/frame/margin/autoHide/span`、文本 `width/height/stretch*/fillPage/z`、`CanvasFrame`、overrides `metadata/crop` |
| `crates/framegeist-core/src/render.rs` | v5 文本渲染路径（legacy 开关）、z 排序、`group` 子画布、`draw_canvas_frame`+`transparent_window`（空白检测）、`apply_crop`、`encode_output_public`、pub(crate) 辅助函数 |
| `crates/framegeist-core/src/exif.rs` | Fujifilm MakerNote 尽力解析（16 键，未知值隐藏）；`ExifInfo.get()` 新键 |
| `crates/framegeist-core/src/text.rs` | FontBook 存原始字节 + 懒加载 fontdb（跨 clone 共享） |
| `crates/framegeist-wasm/src/lib.rs` | 新导出：`layer_boxes`、`render_free_collage` |
| `crates/framegeist-cli/src/main.rs` | `photo-stats` 子命令（showcase 匹配用）；`--legacy-text-renderer` |
| `crates/framegeist-cli/tests/engine_v050.rs`（新） | 15 项 v0.5 断言（含自由拼图/Fuji maker note 手写 TIFF） |
| `crates/framegeist-cli/tests/golden/baselines.json` | **已重生成**（原因：文本渲染器语义变更，报告中已注明） |

### Web / 工具

| 文件 | 内容 |
|---|---|
| `web/editor.js`（新，~1200 行） | 图层面板、直操（拖/缩放/旋转/吸附/方向键）、撤销重做、属性面板、8 风格预设、插入元素、相框、裁切、自由拼图 overlay |
| `web/app.js` | 钩子：`applyEdits`、`editorOverrides`、`setStage→onStage`、`useTemplate/selectTemplate→onTemplateChanged`、`switchMode→onModeChanged`、`buildOverridesJson` 加 `metadata/crop`、自由拼图渲染分支与 `#freeMode/#freeAspect/#freeBg` 接线、`window.__fg` 暴露 `freeActive/freeSpec/updateFreeSpec/freeSpecDefault` |
| `web/index.html` | 新卡片：layers/insert/props/frame/crop；`#freePanel`（自由拼图）；720P 选项；`setKeepMetadata` |
| `web/styles.css` | overlay 手柄/参考线/裁切框、图层行、props 双模、两档面板（`body[data-tier]`） |
| `web/i18n.js` | v0.5 键（zh/en） |
| `web/sw.js` | VERSION → `framegeist-0.5.0` |
| `tools/fetch-showcase-photos.mjs`（新） | 192 张唯一照片分配（11 演示图复用 + Picsum；方向/明暗/饱和匹配；`--extend`） |
| `tools/check-photo-uniqueness.mjs`（新） | 唯一/方向/明暗/隔离/镜像门禁 |
| `tools/gen-samples.mjs`（新） | 按 showcase-map 逐模板渲染（并行 4），`gen-samples.ps1` 变为薄包装 |
| `tools/e2e-audit.mjs` | 79 断言（新增 v0.5 编辑器/引擎 15+ 条）、`FG_CDP_PORT`、watchdog、SW/缓存绕过、控制台错误输出 |
| `templates/art-*.json` ×8（新） | 8 款自创艺术模板（copperplate/gilt/letterpress/woodtype/ukiyoe/deco/republican/seal） |
| `templates/assets/photos/showcase/*.jpg` + `showcase-map.json` + `CREDITS-DEMO.json` | 192 张唯一照片 + 出处 |

---

## 4. 关键实现细节（避免新会话踩坑）

- **每个文本效果都是掩膜后处理**：`text_shape::Shaper::shape` 出 alpha 掩膜 → `text_art::compose_text_layer` 合成（距离场膨胀做描边、偏移掩膜做浮雕/阴影、多段渐变/噪声纹理做填充）。CLI/WASM 逐字节一致（wasm-smoke 已验证）。
- **`mask_unit` = 首行 baseline**（相对效果的尺寸基准），已写入 TEMPLATE-SPEC。
- **`z` 排序**：`(z, 声明序)` 稳定排序；attached badge 仍最后绘制。
- **group 渲染**：渲染到子画布（w/h 显式或整画布）→ 按 opacity 合成；子层 anchor 相对组框。
- **日历**：`dateSource:"exif"` 取 `exif.datetime`（缺失回退固定年/月）；农历查表无数据不显示。
- **相框**：`canvas.frame{asset,autoDetect,scale,inset}`；`transparent_window` 直方图法找最大透明内接矩形；照片按窗口 cover 适配后再叠帧 PNG。
- **编辑器直操**：客户端点击坐标要除以 CSS transform 缩放（`canvasWrap.getBoundingClientRect().width / offsetWidth`）；吸附阈值 8 图像像素；拖拽期间 `history:false` + 松手 `commitNow()` 合并成一步。
- **撤销历史**：`edit()` 首次写入前先 seed 原始 JSON（`before`），否则第一次编辑后无法回到初始状态（本次修过）。
- **`useTemplate` 必须触发 `onTemplateChanged`**（本次修过；否则面板用旧模板渲染）。
- **自由拼图默认布局**：`freeSpecDefault()` 双列网格 + 轻微旋转；画布 1600 长边；`updateFreeSpec(fn)` 改完即重渲。

---

## 5. 待办（按优先级，含验收方式）

### P0 — 完成 M5 自由拼图（唯一"写了一半"的功能）
1. **浏览器手工验证**（CDP 或真机）：进入拼图模式 → 勾选「自由拼图」→ 渲染出现 → 画布拖动/角点缩放/顶部圆点旋转/方向键 → `#freeList` 增删/置顶置底 → 导出 JPEG。
   - 预期风险点：`freeItemBox` 默认高度 `h=0.75` 与引擎实际高度不一致（引擎按照片宽高比算，UI box 用固定 0.75）→ 建议把 `h` 在 `freeSpecDefault` 里设为 `0.42 * (16/9 比例估算)` 或在 UI 用照片真实宽高比；引擎端也可在返回时给 UI 一个 `layer_boxes` 式 API（可选）。
   - `S.freeSel` 在 `onStage`/`onModeChanged` 的刷新路径已接，若初次不显示，检查 `drawOverlay` 的 `r`（需要 img 已 load）。
2. **E2E 增加 2–3 条断言**：自由拼图渲染（尺寸/背景像素）、拖动改变 x/y（读 `window.__fg.freeSpec()`）、增删 item 后像素变化；目标 ≥82 条全绿。
3. 若 UI 时间不够：至少保证「切换自由拼图 → 渲染 → 导出」路径可用，并在 PARITY 中如实标注粒度。

### P0 — M7 剩余门禁（发布前必须）
1. `cargo build --release` 四 target（msvc / wasm32 / aarch64-linux-android / aarch64-unknown-linux-ohos）；android/ohos 需环境（NDK / OpenHarmony SDK），若无则记录证据并说明。
2. 性能复测（契约 §4）：24MP 预览 ≤600ms、导出 ≤2s；60MP 预览 ≤1.5s、导出 ≤4s；`tools/perf/photo-24mp.jpg` 已备。cosmic-text 引入后必测。
3. `node tools/wasm-smoke.mjs` 复跑（已过，但 wasm 每次重建后都要跑）。
4. `cargo clippy --workspace --all-targets -- -D warnings`（已绿；自由拼图 UI 不含 Rust 改动后仍应保持）。
5. 模板模糊测试/全模板加载：`cargo test --release --workspace` 里的 `templates_all_valid` / `fuzz_*` 已覆盖，确认 192 套全过。

### P0 — M6 收尾
1. 「全部 192 套接入新能力与审计」：
   - 至少做一次**接触表视觉审计**（`tools/make-contact-sheets.ps1` 或自建）：192 张 samples 每张人工 Read 目视 + 记录；
   - 对确实适合的旧模板做轻量升级（如 calendar 类模板换真实 `calendar` 层、分割线类换 `span:"auto"`+`autoHide`、标题类换 letterpress/foil 预设），每改一套 `node tools/validate-templates.mjs <file>` + 重渲；
   - 相邻同类模板像素差异 >3%（v0.4 已有断言脚手架，可在 e2e 里加）。
2. `docs/reports/v0.5.0/PARITY.md`：按契约 §3.1 表逐项打勾（模板/背景/相框/画幅/卡片/添加/水印/图层/裁切/日历/拼图/导出/EXIF/历史），100% 才可发布；未达标的必须写清缺失粒度。

### P0 — M8 文档与发布
1. **版本号统一 bump 到 0.5.0**：
   - `Cargo.toml` workspace `version = "0.5.0"`（所有 crate 跟随）；
   - `web/app.js` `APP_VERSION = "0.5.0"`；
   - `web/sw.js` `VERSION`（已是 0.5.0，确认）；
   - `web/manifest.webmanifest`（描述里已有 192 套？确认）；
   - `site/*.json/html` 公告与下载页（`tools/gen-update.mjs` 生成 release 资产时填）。
2. `docs/reports/v0.5.0/README.md`（含 E2E 79→最终条数截图、性能数字、已知取舍）；
3. PRD Discoveries（`docs/prds/framegeist.md`）追加 v0.5.0 发现（黄金基线重生成原因、SW 缓存导致 E2E 假失败、`useTemplate` 通知缺口、wasm 重建后必须重跑 wasm-smoke 等）；
4. `docs/INSTALLATION.md`、`docs/CREDITS.md`（192 张 Picsum 授权/作者表已由 `CREDITS-DEMO.json` 提供）、`docs/TEMPLATE-SPEC.md`（子 Agent 已更新，需人工抽查）同步；
5. 发布（契约 §12 一口气到发布）：
   - `git add -A`（841+ 文件，注意别提交 `docs/reports/v0.4.0/*.png` 的无意义抖动，可考虑 `git checkout --` 恢复或接受）；
   - commit → push（代理不稳时重试）→ tag `v0.5.0` → CI → Release 六资产（CLI/桌面/.fgpkg/NSIS/SHA256SUMS/update.json）→ Pages 验证 200。

### P1 — 清理项
1. `web/editor.js` 里为排障加的 `TRACE`/`trace()` 与 `debug()`：保留 `debug()`（E2E 依赖），但可把 `trace` 限制在 debug 模式或删除（**删除前先改 e2e-audit 中对 trace 的引用**，目前只在失败详情里输出，不删也行）。
2. `tools/e2e-audit.mjs` 里测试用 `window.__selId`/`window.__fgEditor.debug()` 属临时协议，可保留（v0.4 也有 `__fg` 调试钩子）。
3. `docs/reports/v0.5.0/fixture-frame.png` 是审计生成物，建议入仓（E2E 需要）。
4. `.cache/showcase-small/` 临时目录在仓库外（`C:\...\AppData`？实际在 `D:\DSH\.cache\`，已在 .gitignore 确认）。

---

## 6. 已验证证据速查

- `cargo test --workspace`：全绿（core lib 15、exif 7、fuzz 1、template_validation 9、CLI 各套 + engine_v050 **15**）。
- `cargo clippy --workspace --all-targets -- -D warnings`：exit 0。
- `node tools/wasm-smoke.mjs`：`frames byte-identical, collage within PRD N2 pixel gate`。
- `node tools/check-photo-uniqueness.mjs`：8 项 PASS（192 唯一；dark 0.226 vs bright 0.687）。
- `node tools/validate-templates.mjs`（8 art）：`8 ok, 0 failed`。
- `FG_CDP_PORT=9237 node tools/e2e-audit.mjs docs/reports/v0.5.0`：**79/79 passed**（截图在 `docs/reports/v0.5.0/`）。
- 黄金基线：`FRAMEGEIST_UPDATE_BASELINES=1 cargo test -p framegeist-cli --test golden` 重生成（36 条变更，原因=文本渲染器切换）。

---

## 7. Git 状态与注意

- 大量未提交：`M` 841 项（含 `templates/{samples,previews,thumbs}` 全量重渲、`web/*`、`crates/*`、`docs/*`），`??` 仅 `docs/V0.5.0-CONSTRAINTS.md`（以及本次新增文件，见 `git status`）。
- **AGENTS.md 工程铁律**：改动一律用 edit 工具（避免 PowerShell/sed 转义坑）；提交前 `cargo test --release --workspace` + `clippy -D warnings` 全绿；不提交 secrets；frameelf 研究语料严禁入仓。
- 契约红线：不碰 `D:\FrameLoom`；GPS 默认剥离；零上传；不复制 frameelf 资产/文案；黄金基线重生成必须注明原因（已注明）。

---

## 8. 新会话开场建议（可直接复制）

> 读 `D:\DSH\AGENTS.md` 与 `D:\DSH\docs\V0.5.0-CONSTRAINTS.md`，再从 `D:\DSH\docs\reports\v0.5.0\HANDOFF-NEXT-SESSION.md` 接手。
> 继续 v0.5.0：先完成 M5 自由拼图浏览器验证（`node tools/serve.mjs 8123` + headless Edge CDP，`FG_CDP_PORT=<port> node tools/e2e-audit.mjs docs/reports/v0.5.0`），再按 HANDOFF §5 的 P0 顺序推进 M6/M7/M8，中途不停。
> 注意：任何 `crates/framegeist-core`/`framegeist-wasm` 改动后必须重跑 wasm 构建两条命令并跑 `node tools/wasm-smoke.mjs`。
