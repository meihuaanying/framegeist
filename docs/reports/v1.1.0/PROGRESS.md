# FrameGeist v1.1.0 进度报告

## 1. 官方品牌素材落地（v1.1.0）

### 1.1 交付与选片
- 你把官方素材放入 `brand-official-inbox/`（55 个文件 + `SOURCES.json`，含每个文件的来源 URL 与校验说明）。该目录已 gitignore，不随包分发。
- 用 `target/make-inbox-sheet.mjs` 生成 contact sheet（`target/inbox-sheet.png`）逐格目视筛选，产出 `PICKS` / `SKIPS` / `REMOVE` 三张决策表。
- **采用 22 项**（15 项官方原色 + 7 项官方字形按官方色重着色）。跳过项均记录原因：
  - `canon` 三个候选都含锁附元素（红 Canon + 灰 Global / Canon + 感动常在 / 四格标），无可用纯字标 → 保留 v0.9.3 你认可的红字标。
  - `olympus` 素材实为 OM Digital Solutions 徽标，且裁决 4 已定保留 OLYMPUS。
  - `dji` 128px、`oneplus` 32px、`motorola` 24px 均为站点 favicon，质量不足。
  - `fujifilm` / `tamron` / `pentax` / `ricoh` 候选含标语或卡片底图。
  - `apple` 唯一候选是 apple.com 的 og 整幅不透明卡片图（非透明标识）。
  - `yongnuo` 官方域名不可解析（无官方素材来源）。
  - `gopro` / `sandisk` / `nothing` / `xiaomi` 不在徽章库范围内。
- **series 徽章**：仅 `nikon-s` 有官方素材（S-Line）。其余 12 项经核对官方从未作为独立徽标图发布 → 先落机制（`SERIES_ACCENT` + manifest `accent` + 门禁），素材到位即可填入。

### 1.2 导入器 `tools/import-brand-inbox.mjs`（新增）
- 管线：PNG 解码（自写 inflate + 5 种 un-filter）/ SVG viewBox 解析 / 栅格用 `<image href="data:…base64">` 包装 → resvg 渲染 → `place()` 统一几何 → 栅格域 `recolour()` 出 mono/light/thumb。
- **几何约定**（先用 `target/measure-assets.mjs` 实测既有资产得出）：画布高 512、宽按自然比例、墨迹垂直居中 —— ⚠️ 这是首版结论，渲染回归后已修正为「正方形画布 + 宽字标按墨迹高度定尺寸」，见 §1.8 与 §1.11。
- 写入：`web/brand/` + `templates/assets/brand/`（+`thumbs/`）+ `templates/assets/series/`；同步 `tools/brand-colors.json`（`originalColorOverride` + `officialAsset`）与 `web/brand/index.json`（**manifest v5**）。
- `--dry` 保证只读（资产/colors/manifest 全部写入包在 `if (!DRY)` 内，已验证）。

### 1.3 调试中修掉的 5 个真实 bug（全部实测定位，非目视猜测）
1. `measureInk` 坐标系混用：在 1600px 封顶重渲染的像素空间量墨迹却当用户单位用 → 二次缩放 → 画面放大裁切。改为同时返回用户空间 ink 与像素空间 px。
2. `place()` 既有 `viewBox` 定位又有 `<g transform>` → 双重缩放。改为纯 viewBox 定位。
3. `feColorMatrix` 乘法矩阵对已着色素材无效（Nikon 黄、Google 四色纹丝不动）→ 改为栅格域重着色 + 自写 `pngEncode`。
4. `report.applied[].thumb` 写死 `written[3]`，`skipTints` 后数组变长导致崩溃 → 改为按文件名查找。
5. `--dry` 曾污染 `brand-colors.json` 与 `index.json` → 写入全部包进 guard。

### 1.4 颜色口径：从「测源文件」改为「测最终产物」
官方字标常是「黑字标 + 少量彩色」（Blackmagic 的橙方块、7artisans 的红 7、Samsung 的蓝标），源文件采样会把这些误判为彩色品牌。改为渲染 base 变体后测主导色相覆盖率：`hueShare >= 0.5` 才记色。着色 base 直接取 `pick.base` 指定色。

### 1.5 `check-brand-colors` 8 处改造 → 142/142 全绿
manifest 版本 4→5；官方素材品牌跳过「manifest 彩色 = Simple Icons 锁」比对；`pixelStats()` 新增 `hueShare`；brand 彩色判定改为 `hueShare>=0.5`；`tintSkipped` 跳过 mono/light 检查（Nikon 不透明方形标）；`lightOfficial` 跳过「light 必须白」（Meike 官方蓝底白标）；lockup 对官方素材品牌只验 mono 黑（lockup 是旧的字标+标语合成图，未由官方素材重渲）。

### 1.6 移除 `canon-rf-l`
裁决 6「只保留 L」。manifest v5 的 series 组 12 项（canon-l 已是单独 L + 官方红）；`templates/assets/series/` 两个文件删除；`tools/gen-brand-assets.mjs` 的 SERIES 源列表同步移除，避免将来全量重生成复活。模板与 E2E 对它的引用数均为 0 ✓。

### 1.7 目视复核
`target/imported-brand-sheet.png`（66 格 = 22 slug × base/mono/light）逐格核对全部正确：Google 官方四色、Leica 官方红圆、Voigtländer 官方书法体（审计最大差异已修复）、ZEISS 官方蓝盾、HUAWEI 红、insta360 黄、Meike light 蓝底白标 plate、Nikon 黄底方块 + 保留黑白字标 ✓。

### 1.8 ★ 真实回归：官方字标压住 info block 文字（对比图目视发现 → 实测定位 → 已修复）
- **现象**：对比图右侧（v1.1.0）官方字标明显变大并压住信息行 —— `phone-accent-dots-01` 的 SONY 压住「1/250s · ISO100」、`phone-paper-spec-01` SONY 撑到画布右缘、`phone-vendor-bar-01` SONY 压住信息行；v1.0.0（左侧）正常。
- **定位（新写 `target/png-dims.mjs`：自写 PNG 解码 + alpha ink bbox，输出 canvas/ink/aspect/pad）**：`old-sony.png` = canvas **512×512** / ink **512×90** / padY 211/211 ↔ 新 `sony.png` = canvas **2048×512**（画布纵横比 4:1 ✗）。canon 两侧完全一致（697×512 / ink 681×168），证明差异只来自导入器。
- **根因**：旧资产约定是**正方形 512×512 画布、ink 等比缩放后垂直居中**（sony 的 ink 只有 90px 高，居中，上下各 211px）；而 `place()` 用了「画布高 512、宽 = 自然比例、上限 MAX_W=2048」→ `scale = min(512/88, 2048/500) = 4.1`。引擎按**高度**定徽标尺寸后，再乘**画布纵横比**得宽度 → 4:1 的画布把 SONY 宽度放大约 4 倍 → 压住文字。
- **修复**：`place()` 改为**正方形画布** —— `side = targetH`（品牌 512 / 缩略图 96），`scale = min(side/ink.w, side/ink.h)`，ink 在方框内居中；`MAX_W` 不再参与。方形画布是保守选择：引擎不会横向溢出。
- **验证（决定性证据）**：新 `templates/assets/brand/sony.png` = canvas 512×512 / ink 512×90 / padY 211/211，与 `old-sony.png` **完全一致**；canon 未被改动 ⇒ 新旧资产画布几何一致，**仅美术更换**，模板排版与压字问题消失 ✓。修复后 `check-brand-colors` 仍 **142/142** ✓。
- **纪律**：这次是「只跑门禁看不出问题」的典型 —— 门禁只验资产像素与色值，不验「资产在画布上的占位」。后续凡改徽标资产，必须用 `png-dims` 类工具对比新旧 canvas/ink 几何，并用对比图目视。

### 1.9 E2E 全量 287/287
- run1 = 286/287：唯一失败 `v0.9.3 badge lib: manifest v4 with five groups`（断言写死 `lib?.v === 4`，manifest 已升 v5）→ 改为 `v1.1 badge lib: manifest v5 with five groups` + `lib?.v === 5` ✓。
- run2 = **287/287 全绿** ✓（真实 CDP 输入）。品牌相关断言实测：`colorful brand thumb carries official color {"nikon":6840,"nikonMono":0,"sony":0,"canon":1285,"nikonLockup":1762,"canonLockup":1730,"series":0}` ✓；`badge layers render at >= 6% photo height {"ratio":0.06,…,"badgeH":72}` ✓。
- 兼容性核查：`web/app.js` 只读 manifest 的 `slug/label/official/color` 四字段（`:749/:761/:785/:871`），v5 新增字段（`officialAsset`/`sourceUrl`/`color`/`lightOfficial`/`tintSkipped`/`accent`）均为增量 ✓；`templates/*.json` 对 `canon-rf-l` 引用数 0 ✓；`:2882` 的 series 单色断言采样 `sony-gm`（无 accent）而非 nikon-s ✓。

### 1.10 版本号四处 + 文档
- `Cargo.toml:6`、`crates/framegeist-desktop/tauri.conf.json:4`、`web/app.js:9`（APP_VERSION）、`web/sw.js:6`（`framegeist-1.1.0`）、`target/probe-desktop.mjs:47`（版本断言）全部 1.1.0 ✓。
- `docs/releases/v1.1.0.md` 已创建；`docs/CREDITS.md` 三处更新（系列徽章清单 + v1.1.0 官方素材段含 inbox gitignore 与来源 tier + 商标声明区分「未提供者用 Simple Icons hex 重绘」与「22 品牌用经授权官方标识本身」）。

## 1.11 第二轮回归：宽字标墨迹高度 + 新增几何门禁

- **现象**：第一次回归（§1.8 画布纵横比）修完后，官方宽字标的**绘制高度**仍偏高。几何门禁首版「必须正方形画布」把 8 个既有资产判失败（olympus 1043×512、pentax 888、ricoh 737、sigma 747、tamron 876、laowa 757、samyang 1029、tokina 876、yongnuo 1015，墨迹高 156–161/512）→ 证明 v0.7–v0.9 生成器的约定是**宽画布 + 墨迹高约 160/512**，真实不变量是**墨迹高度**而非画布形状。
- **暴露的真实问题**：
  - `dji` 512×512 ink 512×302（aspect 1.70、ratio 0.590）—— 既有资产，官方 favicon 已按 SOURCES 标注跳过导入 ✓；
  - `7artisans` 512×512 ink 512×229（aspect 2.24、ratio 0.447）—— **本次新导入**，比 v1.0.0 基线（1240×512 ink 954×158、ratio 0.309）高 **1.44 倍**。原因：方形画布下 `scale = min(512/w, 512/h)` 对宽字标按**宽度**定尺寸，而引擎按**高度**绘制 → 字越高、与 info block 文字相撞的概率越大。
- **导入器修复**：`tools/import-brand-inbox.mjs` 新增 `WORDMARK_ASPECT = 2.2` 与 `WORDMARK_INK_H_RATIO = 0.3125`（160/512）；`place()` 对 `ink.w / ink.h > WORDMARK_ASPECT` 的宽字标改用 `scale = min(side/ink.w, WORDMARK_INK_H_RATIO*side/ink.h)`（按**墨迹高度**定尺寸），图标/方形标仍填满方框（leica / nikon / zeiss 保持满幅 512×512）。
- **修复后几何实测**（`target/png-dims.mjs`）：sony = 512×512 ink **512×90** padY 211/211（与 v1.0.0 **逐像素一致** ✓）；7artisans = 512×512 ink **358×160** padX 77/77、ratio 0.3125（v1.0.0 ratio 0.309，等价 ✓）；leica / zeiss = 512×512 满幅 ✓。
- **新增几何门禁**（`tools/check-brand-colors.mjs`）：这类回归**像素与色值门禁看不见**（压字不是颜色错误），因此 `pixelStats()` 增补 ink box（alpha ≥ 128 的紧包围盒）并返回 `width/height/ink/padX/padY`；新增检查：ink aspect > `WORDMARK_ASPECT`(2.2) 的字标必须满足 `ink.h ≤ 0.34 × canvas.h`（既有资产最大值为 canon 0.328，留少量余量）。阈值先试 1.5 被 dji（aspect 1.70、ratio 0.590，既有资产）否掉 → 定为 2.2；高度上限先试 0.4 被 7artisans（0.447）捕获 → 定为 0.34。
- **门禁结果**：`brand color gate: 250/250 checks passed` + `variant matrix + official colors verified`（较修复前 +8 项几何检查）✓。
- **纪律（写入本次经验）**：更换徽标资产必须同时做三件事 —— ① `target/png-dims.mjs` 对比旧资产画布/墨迹几何；② 门禁的像素与色值全绿不代表布局安全；③ 渲染样片后**目视对比图**（第一、二轮回归都是对比图先发现的，单测与门禁均未报警）。

### 1.12 资产重生成 + 对比图目视复核（两轮回归均确认修复）

- 重生成链全部成功 ✓：`make-imported-sheet`（66 格 = 22 slug × base/mono/light）→ `gen-samples` **`rendered=192 failed=0`（576 张）** → `visual-regression --update` **`visual baseline updated: 384 images`** → `make-compare-sheets` **`25 categories, 150 before/after pairs -> docs/reports/v1.1.0/compare`**（before = v1.0.0 / after = v1.1.0 ✓）。
- **`phone` 分类目视（第一轮回归的暴露面）**：`phone-accent-dots-01` / `phone-paper-spec-01` / `phone-vendor-bar-01` 三套在 v1.1.0 侧版式与 v1.0.0 一致；SONY 官方字标落在右上/右侧角落，**不再压住 info block 文字**（`1/250s · ISO100`、`f/4`、`ILCE-7RM3` 全部清晰可读）✓。
- **`camera` 分类目视**：`camera-baseplate-02`（Canon 官方红 lockup 左上）、`camera-ricoh-slimline-08`（红点 bar + info block）、`camera-topdeck-bar-01`（Nikon 徽标）**均无重叠**；Nikon 在浅底上自动回退 `-mono` 黑白字标（`skipTints` 保留的旧字标），与裁决 10「浅底强制 `-mono`」一致 ✓；info block 文字与徽标共存无遮挡 ✓。
- ⇒ 第二轮回归（宽字标墨迹高 0.447 → 0.3125）在上述两类均**无可见偏差** ✓。

### 1.13 E2E 与全量门禁（2026-10-01）
- **E2E 全量**（真实 CDP 输入事件）：run1 = 286/287，唯一失败 `v0.9.3 badge lib: manifest v4 with five groups` —— 断言写死 `lib?.v === 4`，manifest 已升 v5 → 改为 `v1.1 badge lib: manifest v5 with five groups`；**run3 = 287/287 passed，EXIT=0**（run2 为几何修复后的资产，run3 为门禁几何项落地后的最终态）。品牌断言实测值：`{"nikon":6840,"nikonMono":0,"sony":0,"canon":1285,"nikonLockup":1762,"canonLockup":1730,"series":0}`、`badge layers render at >= 6% photo height {"ratio":0.06,…,"badgeH":72}`。
- **兼容性核查四点**：`web/app.js` 只读 manifest 的 `slug/label/official/color` 四字段，新增字段全为增量；`templates/*.json` 对 `canon-rf-l` 引用数 0；E2E 系列单色断言采样 `sony-gm`（无 accent）而非 `nikon-s`；`nikon` 走 `skipTints` 保留既有黑白变体，故「浅底强制 `-mono`」（裁决 10）仍由 v0.9.0 的 3:1 对比度门自动满足。
- **全量门禁**（`target/gates-v110.log`，全绿）：`validate-templates --all` **192 ok / 0 failed**（VALIDATE_EXIT=0）、`cargo fmt --all --check`（FMT_EXIT=0）、`cargo clippy --workspace --all-targets -- -D warnings`（CLIPPY_EXIT=0）、`cargo test --release --workspace`（TEST_EXIT=0，17 个套件全 `ok.`）、三 cross target `wasm32-unknown-unknown` / `aarch64-linux-android` / `aarch64-unknown-linux-ohos`（全 0）、`node tools/wasm-build.mjs`（WASM_EXIT=0，smoke **帧字节一致**）。
- **JS 六项门禁**（全绿）：i18n **524 zh / 524 en, 0 failures**、品牌色 **250/250**、UI 对比度 all pass、字形 **192 templates / 279 family-char pairs / 0 missing**、UTF-8 **948 text files / 0 broken**、照片唯一性 all gates green。
- **桌面端**：`cargo build --release -p framegeist-desktop` → **DESKTOP_EXIT=0**（3m49s，重新嵌入 v1.1.0 web 资产）；启动 + CDP 9333 探针 **9/9 PASS**：boot / **版本 1.1.0** / 192 套模板 / 渲染帧与识别框一致（1792×1560）/ 可点盒 `bar` / **真实点击选中 `["bar"]`** / 选中不改变缩放平移 / locate 按钮存在 / locate 把选中拉回视口 ✓。

## 2. 待办（进行中）
- E2E 全量 287 项
- 样片 576 张 + 视觉基线 384 项 + 对比图 25 类 150 组重生成（品牌资产变更会影响引用 `@builtin/brand/*` 的模板渲染像素）
- 全量门禁（fmt / clippy -D warnings / test / 四 target / JS 七项 / wasm）
- 桌面端探针 9/9
- 版本号四处 1.1.0 + release notes + AGENTS 横幅
- 提交推送 + tag v1.1.0 + Release 六资产 + Pages 验证
