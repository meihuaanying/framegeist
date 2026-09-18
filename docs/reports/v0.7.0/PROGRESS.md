# FrameGeist v0.7.0 Progress

> Contract: `docs/V0.7.0-CONSTRAINTS.md`. One section per milestone, written as soon as the milestone gate is green.

## M0 — 字体管线 ✅ (2026-09-18)

- **来源与许可（全部 OFL-1.1，SHA256 固定）**：`tools/fetch-fonts.mjs --fetch` 下载 11 组新字体（Fraunces、Bricolage Grotesque、Instrument Serif、Instrument Sans、Geist、Geist Mono、Onest、Unbounded + 得意黑 Smiley Sans、霞鹜文楷 LXGW WenKai、未来荧黑 Glow Sans SC、更纱黑体 Sarasa Gothic SC），并为既有 Inter/Playfair/Oswald/Cormorant/Space Grotesk/JetBrains Mono/Noto Sans SC/Noto Serif SC 补齐字重。全部 SHA256 记录在 `tools/font-pins.json`（release 资产同时校验 API 声明大小）；许可全文落 `templates/assets/fonts/licenses/`。
  - 踩坑记录：GitHub 直连 `github.com`/部分 raw 大文件不稳 → 增加 jsDelivr 镜像回退 + `gh release download` + 内容长度校验；py7zr 对 Sarasa 7z 报 `LZMAError` → 回退 Windows bsdtar（`C:\Windows\System32\tar.exe`）成功。
- **静态实例化**：`tools/instance-fonts.py` 用 fontTools `varLib.instancer` 把可变拉丁字体钉到 400/500/600/700（轴固定：Fraunces opsz=72/SOFT=0/WONK=0，Bricolage opsz=36，Inter opsz=16，Instrument Sans wdth=100），写回 OS/2 usWeightClass、name ID 1/2/4/6/16/17，再 pyftsubset（latin 范围）→ 每文件 25–90 KB。
- **CJK 子集**：`tools/subset-cjk.py` 扩展为读 `source/sources.json`，对全部 CJK 源（Ma Shan Zheng / Noto Sans SC / Noto Serif SC / Smiley Sans / LXGW WenKai / Glow Sans SC / Sarasa Gothic SC）按「GB2312 一级 + 标点块 + 仓库实际用字」子集化，并同一套 name/OS-2 归一；按 face cmap 过滤缺失字符并报告。产出 15 个 CJK face（400–700 字重）。
- **产物**：`templates/assets/fonts/*` = **68 faces / 22 families**；`fonts.json` 每文件一条（family/file/weight/license，CJK `lazy:true`）；镜像 `web/fonts/engine/` 26 MB。
- **引擎多字重**：`text.rs` FontBook 改为 key → Vec<FontEntry>（同族多 face），OS/2 usWeightClass 解析、legacy `pick` 取最接近 400 的 face、fontdb 装载全部 face；模板 `font.weight` 经 cosmic-text/fontdb 精确选面。像素断言 `engine_v070.rs::font_weight_picks_distinct_faces`：同文本 400 < 600 < 700 墨量严格递增（通过）。
- **Web 加载**：`app.js` `ensureFont` 改为按 family 拉取全部字重文件；新增 `ensureTemplateFonts()` 渲染前按模板 JSON 里的 family/fontFamily 按需注册（CJK 不首屏预载，`lazy` 不入 warmup）；字体选择器去重。
- **字形覆盖门禁**：`tools/check-glyph-coverage.mjs`（纯 Node cmap 解析 format 4/12）扫描全部 192 套模板文字层字面量：**355 family/char 对，0 缺失**（修复：Ma Shan Zheng 曾被当作拉丁字体子集化只剩 ASCII，已移入 CJK 管线重建）。
- 回归：`cargo test -p framegeist-core` 全绿（82 tests，含新 2 项 brand 系列 + v0.7.0 字重测试）。
- 备注：字体源文件在 `templates/assets/fonts/source/`（gitignored，不入分发；M5 打包需排除）。

## M1 — 徽标系统 v2 ✅ (2026-09-18)

- **资产双轨**（`tools/gen-brand-assets.mjs` 重写）：Simple Icons CC0 官方图标（扩展到 30 slug：相机/镜头/手机/配件，含三星/Google/摩托罗拉/黑魔法等）+ **全品牌原创排版 lockup**（42 slug，走 Geist/Instrument Serif 排版，不复制官方图形）+ 系列徽章 12（GM/G/L/RF L/S/Art/DG DN/APO/XCD/XF/Batis/SP）+ 游戏字标 6。产物：`brand/` 76 PNG、`lockup/` 84 PNG、`series/` 24 PNG、`game/` 12 PNG，黑/白双版本，CC0/OFL 记录在 `brand/CREDITS.json` 与商标声明。
- **引擎规则**（`render.rs`）：徽标识别（brand/lockup/series/lens）；尺寸下限（≥3.5% 照片高且 ≥18px）；最大宽度（默认 32% 照片宽，长 lockup 不溢出）；固定四角 `corner`+`margin`；花底对比保护（按背景 p10/p90 在黑白变体间择优，必要时反色 1px 描边/半透明底板）；透明度 0.7–1.0。`TemplateOverrides` 新增 `brandStyle/brandPosition/brandScale/brandContrast/brandOpacity`；`ImageLayer` 新增 `corner/margin/contrast/maxWidth/minHeight`。
- **引擎测试**（`engine_v070.rs`，4 项全绿）：字重墨量递增；尺寸下限生效；黑/白/花底对比（花底断言同时出现深/浅像素 = 描边保护）；最大宽度 + 左上角定位。
- **品牌解析扩展**（`brand.rs`）：MAKE_MAP 增补手机/平板/配件/Phase One/Blackmagic/Nothing 等；LENS_MAP 增补 Viltrox/老蛙/铭匠/图丽/Samyang/Meike/7Artisans/Sirui/永诺/Voigtländer；系列增补 G / RF L / Batis / APO / SP（测试同步 7 项新断言）。
- **编辑器面板**（Q6）：风格（官方/原创）、位置（跟随模板/四角）、大小 S/M/L、对比保护（自动/浅/深/描边/底板）、不透明度滑杆；按模板持久化于 override 存储；`effectiveTemplateJson` 在 original 风格时把 `@builtin/brand/` 重写为 `@builtin/lockup/`。
- **UI 展示面**（Q1）：模板墙头 + 灯箱底部品牌条（模板静态 slug 优先，否则演示品牌）；暗色自动反色。
- **模板覆盖**：带徽标模板 130 → **169**（M2 脚本为水印/参数类缺水印模板自动补角标，其余分类保留原设计；game 不注入官方品牌）。
- ⓘ **Q13/Q18 取舍记录**：EXIF 数值行默认 Inter `tnum`（Q13）；器材类（camera/film/phone/drone/fuji）数据行用 Geist Mono（Q18）；中文日期等 CJK 数据行使用分类 CJK 字体（已过字形门禁）。

## M2 — DESIGN-LANGUAGE v2 + 192 套重排 ✅ (2026-09-18)

- `docs/DESIGN-LANGUAGE.md` 升级 v0.7.0：新增 §3 排版系统 v2（字号阶梯/字距行高/字重层次/中英混排/分类风格映射/徽标规范），QA 清单同步（version 1.1.0 / minEngineVersion 0.7.0 / 徽标层 / 字形门禁）。
- `tools/apply-v070-typography.mjs` 全量重排 192 套（确定性、可重复执行）：按 Q18 分类风格表映射 Display/Support/Label/Data 四类角色字体；按 Q13 给数值行加 `features:["tnum"]`；Display 紧字距 −0.02em、微标签 ≥+0.08em、CJK 标题 0~+0.02em；Display 行高收紧到 1.15；最小字号下限 0.0095；`|` 分隔符统一为 `·`；为 39 套水印/参数类模板补品牌徽标层（按四角占用计分选择角位）；`minEngineVersion` → 0.7.0、`version` → 1.1.0。
- 校验：`validate-templates.mjs --all` **192 ok / 0 failed**；`check-glyph-coverage` 355 对 0 缺失（修复了一次 CJK 日期行被映射到 Inter 的回归）。
- 重渲：`gen-samples` 576 张（samples 900 / previews 640 / thumbs 240）0 失败 + web 镜像；视觉基线**有意重生成**（原因：v0.7.0 字体/字重/排版全面换代 + 39 套新增徽标层），`tools/visual-baselines.json` 384 项。
- 前后对比图：`docs/reports/v0.7.0/compare/` 25 个分类文件 × 每类 2–3 套（共 75 组，v0.6.1 左 / v0.7.0 右），供人工审阅。

## M3 — UI 现代化 + 墙/灯箱重做 ✅ (2026-09-18)

- 流体字号阶梯 `clamp()`（--fs-2xs…--fs-2xl），正文提升到 16px，`font-optical-sizing: auto`。
- 新增可变 UI 字体 Geist VF（woff2-variations，OFL，latin 子集 31KB）用于 display 标题。
- 模板墙重做：超大标题（clamp 27–36px）+ 计数 pill；分类 chip 移至图片左上玻璃拟态；卡片 hover 图片 1.035 缩放 + 名称层级/字重提升。
- 灯箱重做：标题 var(--fs-xl) + 分类 chip；舞台更大（72vh）；底部品牌条 + 主按钮。
- 暗色 `--text-muted`/`--text-faint` 提亮以满足 APCA。
- 新门禁 `tools/check-ui-contrast.mjs`（APCA 0.1.9）：浅/深主题 6 组文本对 + 按钮渐变端点，全部 PASS（暗色 muted Lc −63.7、faint −35.4）。

## M4 — 全量门禁 ✅ (2026-09-18)

- **工程门禁**：`cargo fmt --all --check` ✓；`cargo test --release --workspace` 21 套全绿；`cargo clippy --workspace --all-targets -- -D warnings` ✓；四 target 构建 ✓（wasm32-unknown-unknown / aarch64-linux-android / aarch64-unknown-linux-ohos / x86_64-pc-windows-msvc）；`node tools/check-utf8.mjs` 867 文件 0 损坏。
- **基线重生成（有意，记录原因）**：
  - `tools/visual-baselines.json` 384 项 —— 字体/字重/排版换代 + 39 套新增徽标层；
  - `crates/framegeist-cli/tests/golden/baselines.json` 36 项 hash 变化 —— v0.7 多字重选择（`weight:600` 现在命中静态 600/700 而非唯一 Regular）+ 徽标对比保护；
  - 重生成命令：`node tools/visual-regression.mjs --update`、`FRAMEGEIST_UPDATE_BASELINES=1 cargo test --release -p framegeist-cli --test golden`。
- **WASM**：`node tools/wasm-build.mjs` 固化 cargo+SIMD → wasm-bindgen 0.2.128 → wasm-opt -O2（npx 修复 Windows shell 调用）→ smoke；体积记录 **5,058,173 B**（wasm-opt 缩小 15.6%）；smoke 改为注册全部 68 faces（与 CLI 字体目录一致），帧渲染字节一致、拼图 0.000013 ≤ 0.001。
- **E2E**：`FG_CDP_PORT=9237 node tools/e2e-audit.mjs docs/reports/v0.7.0` → **218/218**（v0.6 基线 195 + 新增 23：多字重清单/懒加载/字重像素差/徽标风格切换与面板五控件/尺寸下限钳制/排版 v2 与 tnum/UI 墙与灯箱品牌条/Geist UI/正文 16px/无控制台异常）。
- **字形覆盖**：`check-glyph-coverage` 192 套 355 对 0 缺失。
- **视觉回归**：384/384 在容差内（hamming ≤10、meanΔ ≤2.5）。
- **性能**：`node tools/perf-audit.mjs`（CDP 真浏览器）24MP 预览 186ms / 导出 990ms；60MP 预览 338ms / 导出 2466ms —— 4/4 达标。
- **对比图**：`docs/reports/v0.7.0/compare/` 25 分类 × 2–3 套（v0.6.1 左 / v0.7.0 右）。
