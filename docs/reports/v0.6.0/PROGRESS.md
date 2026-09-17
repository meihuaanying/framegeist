# FrameGeist v0.6.0 Progress

> Contract: `docs/V0.6.0-CONSTRAINTS.md`. One section per milestone, written as soon as the milestone gate is green.

## M0 — 前置校验 ✅ (2026-09-16)

- 三张原图就位于 `D:\FrameGeist\incoming\`（gitignored，不入仓）：
  | id | file | 机型 | 镜头 | 参数 | 尺寸/方向 |
  |---|---|---|---|---|---|
  | sony-a7r3 | DSC09556.jpg | SONY ILCE-7RM3 | Viltrox AF 35/1.2 LAB FE | 35mm f/4 1/250s ISO100 · 2026:05:02 15:13:35 | 5304×7952 竖 |
  | nikon-z6ii | DSC_6050.jpg | NIKON Z 6_2 | Viltrox AF 24/1.8 Z | 24mm f/1.8 25s ISO2500 · 2026:03:15 03:37:24 | 6048×4024 横 |
  | canon-r7 | IMG_8387.JPG | Canon EOS R7 | 16-300mm F3.5-6.7 DC OS \| Contemporary 025 | 142mm f/6.3 1/40s ISO6400 · 2025:12:31 22:42:10 | 6960×4640 横 |
- 校验：三张均 ≥5 项有效字段（机型/镜头/焦段/光圈/快门/ISO/日期全齐）；sha256 与来源信息写入 `docs/reports/v0.6.0/source-exif.json`。
- **Q8 说明**：三张原图均无 GPS 标签 → 「样例保留 GPS」条款自动失效（无可保留数据），用户导出默认剥离 GPS 的红线不变。
- 映射规则（确定性）：竖版样片注入 Sony EXIF；横版样片按模板 id 排序交替注入 Nikon / Canon EXIF。

## M1 — 样片真实化管线 ✅ (2026-09-16)

- 新增 CLI `exif-inject`（容器级复制 EXIF，不重编码）与 `photo-shrink`（长边压缩保留 EXIF+ICC），核心实现在 `photo_meta.rs`（img-parts），测试 `photo_meta.rs` 4 项。
- 三张原图 → `web/examples/{sony-a7r3,nikon-z6ii,canon-r7}.jpg`（≤2560，q92，EXIF+ICC 保留）+ `web/examples/exif.json`（编辑器示例预览档案）。
- `tools/prepare-showcase-exif.mjs`：按真实像素方向把三份 EXIF 注入全部 192 张 showcase 照片（竖→Sony；横→Nikon/Canon 交替），刷新 `showcase-map.json` / `CREDITS-DEMO.json` 的 sha256 + `exif_source`；支持 `--check`。
- `check-photo-uniqueness.mjs` 增补 EXIF 门禁：192/192 有真实 EXIF、方向-机型映射正确、机型分布均衡（79/79/34）——全绿。
- 576 张 samples/previews/thumbs 重渲 + web 镜像。

## M2 — 排版与体验 ✅ (2026-09-16)

- 引擎：文本层 `features`（OpenType，白名单校验）；`date('LOCAL', …)` 本地化（zh `2026年5月2日` / en `MAY 2, 2026` / 无 locale 回退 ISO）；`aperture`/`shutter` 写法打磨（4→"4"、25.0s→"25s"）；`TemplateOverrides.exif` 预览覆盖（白名单键、类型/长度校验）。
- 模板批量打磨 `tools/apply-v060-template-polish.mjs`：179 套变更（148 处 `date('YYYY.MM.DD')`→`LOCAL`、93 处 `Unknown Camera` 占位产品化、399 个 EXIF 文本层启用 `tnum`），`minEngineVersion` 升 0.6.0；192 套全部校验通过。
- Web：示例照片 chips（日落/星河/街头）、无 EXIF 提示 + 「填入示例预览」/「清除示例」、UI 语言驱动 `dateLocale`、导出前元数据透明提示；`extra.exif` 合并修复；语言切换触发重渲。
- 引擎测试 `engine_v060.rs` 4 项；E2E 169/169。

## M3 — 前沿增强 ✅/ⓘ (2026-09-16)

- **EXIF 字节级直通导出** ✅：`exif_surgery.rs`（端序/边界/深度安全 IFD 重建；剥离 GPS 0x8825、序列号 0xA430/31/35；Orientation 归一 1；未知标签/MakerNote/IFD1 缩略图原样保留；畸形回退白名单）；7 项测试含 1 万次变异 fuzz；金标按 Q13 重生成（原因：导出 APP1 字节变化）。
- **ICC 色彩直通** ✅：`color.rs`（moxcms 纯 Rust，Display P3/AdobeRGB→sRGB 数值转换；sRGB 档案零操作；畸形降级不改像素），接入 `decode_oriented`（预览缩放后执行）；3 项单测。
- **EXIF 字段点选插入** ✅：编辑器文本属性面板 13 个 token + 参数行 chips，经 `edit()` 追加可撤销；E2E 8 条。
- **样片视觉回归门禁** ✅：CLI `visual-hash`（dHash+均色）+ `tools/visual-regression.mjs` + `tools/visual-baselines.json`（384 图），检查全绿。
- **Web HEIC 解码** ✅：vendor `libheif-js@1.23.2`（`web/vendor/libheif/libheif-bundle.mjs`，LGPL-3.0 全文入 `docs/licenses/` + CREDITS），ftyp 嗅探后惰性 import；>64MB/>40MP 守护；EXIF 尽力（libheif 不产出 EXIF，容错为 null）；离线首访给 `err.heicOffline` 提示。
- **AVIF/WebP 导出** ✅：`image` avif/webp（纯 Rust）；CLI `--format avif|webp`、Web 导出格式选择（快预览保持 JPEG）；AVIF/WebP 均携带 EXIF（EXIF item / RIFF EXIF chunk）；4 项测试。ⓘ `image` 未开 `avif-native`：CLI `pixel-hash/visual-hash` 不能解码 `.avif`（浏览器可）。
- **wasm SIMD + wasm-opt** ✅：`.cargo/config.toml` 启用 `+simd128`；`tools/wasm-build.mjs` 固化 cargo→wasm-bindgen→`wasm-opt -O2`（binaryen v132）→smoke；模块 5.95MB（预算 15MB），帧字节一致，性能 4/4 通过。
- **引擎字体离线** ✅：引导后 `requestIdleCallback` 顺序预取 fonts.json 全量（并发 1），写入 CacheStorage；E2E 断言 9/9 cached。
- **Tauri/依赖升级** ⓘ：crates.io 最新稳定 = 2.11.5 = 当前锁定版本（3.x 仍 alpha），维持现状并记录。
- E2E 终态 **195/195**（无页面错误）。

## M4 — 全量门禁 ✅ (2026-09-16)

| 门禁 | 结果 |
|---|---|
| `cargo fmt --check` / `clippy -D warnings` / `cargo test --release --workspace` | CLEAN / exit 0 / 0 失败套件 |
| WASM↔CLI `wasm-smoke` | 帧字节一致；拼图差 0.000013 |
| 四 target | msvc / wasm32 / aarch64-linux-android / aarch64-unknown-linux-ohos 全过 |
| 性能（§4） | 24MP 预览/导出、60MP 预览/导出 4/4 PASS（导出含 ICC 变换） |
| 唯一性 + EXIF 门禁 | 全绿（192/192 真实 EXIF，映射正确） |
| 视觉回归 | 384/384 在阈值内 |
| E2E | 195/195 |

## M5 — 文档与发布 ✅ (2026-09-16)

- 版本统一 **0.6.0**：`Cargo.toml` workspace / `tauri.conf.json` / `web/app.js APP_VERSION`；SW 缓存 `framegeist-0.6.0`。
- 文档：`README.md`（本报告）、PRD Discoveries v0.6.0 条目、`CREDITS.md`（示例摄影 + libheif-js LGPL 全文路径）、`TEMPLATE-SPEC.md`（`features` / `date('LOCAL')` / `dateLocale` / `exif` 覆盖）、`schema/template.schema.json`（同上）、`AGENTS.md`（v0.6.0 状态 + `wasm-build.mjs` 环境速查）、`INSTALLATION.md`（wasm 固化管线）。
- 发布执行：commit `6ea2577` → push `main` → tag `v0.6.0` → CI **success**（main + tag）、release **success**、pages **success**。
- Release `v0.6.0` 六资产：`framegeist-cli-v0.6.0-win-x64.zip`、`framegeist-desktop-v0.6.0-win-x64.zip`、`framegeist-templates-v0.6.0.fgpkg`、`FrameGeist-v0.6.0-win-x64-setup.exe`、`SHA256SUMS.txt`、`update.json`。
- Pages 验证：首页 200、`download.html` 200、新增示例照片 `web/examples/sony-a7r3.jpg` 200。

## v0.6.1 补丁 — 桌面端/线上 `app.js` 编码损坏修复 (2026-09-16)

**现象**：桌面端与 PWA 永久停在「引擎加载中」。

**根因**：v0.6.0 收尾时用 `powershell (Get-Content -Raw) -replace ... | Set-Content` 改写 `web/app.js`——Windows PowerShell 5.1 在无 BOM 时按系统 ANSI（CP936）读写，导致全部非 ASCII 字符被重编码、且部分多字节字符吞掉了后续 ASCII 引号；第 131 行主题 emoji 处产生 `SyntaxError: Unexpected identifier 'light'`，模块加载失败，引擎永不初始化。事故已随 v0.6.0 提交并进入 Release 资产与 Pages。

**修复**：字节级定位 12 处受损行（对父版本 `9daff9e` 逐行比对恢复 + 1 处新注释重建），文件统一回 UTF-8/LF；全仓 733 个文本文件 UTF-8 完整性扫描 0 异常。桌面端重建后 `status=就绪、engine=true`；E2E 195/195。

**防复发**：禁止用 PowerShell `Set-Content/Out-File` 改写含非 ASCII 的仓库文件（统一走 Edit 工具或 Node 脚本）；发布前新增 UTF-8 完整性扫描（见下）。

**发布**：v0.6.1 补丁（版本号 Cargo/tauri.conf/app.js/sw.js 统一 0.6.1）；v0.6.0 资产保留并标注警告。
