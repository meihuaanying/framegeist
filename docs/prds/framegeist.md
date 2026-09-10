# FrameGeist（框灵）— 跨平台照片边框水印与拼图工具

> PRD 版本：v1.0 ｜ 编写日期：2026-09-09 ｜ 目标读者：零上下文的执行型 AI 与人类开发者
> 编写方法：`max4c/skills` 的 `write-prd` 流程（上下文加载 → 同类项目勘察 → Socratic 审问 → 草稿 → `grill-me` spec 门禁）
> 对标产品：[FrameElf](https://frameelf.com/)（功能等价，非资产复制）
> 交付范围：**本 PRD 只交付规格文档，不交付代码**。代码实施为后续独立任务。

---

## Goals

做一个**免费、开源、可离线、四端一致**的照片边框水印工具，覆盖摄影爱好者分享照片时最刚需的三件事：给照片加带 EXIF 参数的边框/水印、把多张照片拼成一张、把 Live Photo 也套上边框后原样导出。

与 frameelf 的差别不在功能多少，而在**所有权与自由度**：frameelf 是闭源订阅制（终身 $32.99），框灵是 MIT 开源、全部功能免费、模板可被用户自制与流通、照片永不离开本机。技术目标是**一套 Rust 核心驱动 5 个客户端**（CLI / Web / Windows / Android / HarmonyOS），让同一模板在四端产出像素级一致的成品。

判定"做完"的标准不是界面长得像 frameelf，而是：**同一张照片 + 同一份模板 JSON，在四端导出的图片通过黄金图回归（差异 ≤ 0.1% 像素），且 EXIF 关键字段保留率 ≥ 99%。**

---

## Requirements

需求编号用于后续 issue/PR 引用。`[P0]` = v1.0 必须，`[P1]` = v1.x，`[P2]` = v2.0 或社区贡献。

### A. 核心引擎（`framegeist-core`，Rust，无 OS 依赖）

- [ ] `A1 [P0]` 引擎可编译到 `x86_64-pc-windows-msvc`、`aarch64-linux-android`、`aarch64-unknown-linux-ohos`（鸿蒙）、`wasm32-unknown-unknown` 四个 target；CI 对四个 target 各跑一次 `cargo build --release` 守卫可移植性。
- [ ] `A2 [P0]` 引擎对外只暴露三个能力：`load_template(json) -> Template`、`render(photo, template, options) -> ImageBytes`、`probe_exif(photo) -> ExifInfo`。GUI 客户端不实现任何绘制逻辑。
- [ ] `A3 [P0]` 引擎生产路径禁止 `unwrap()` / `panic!()` 处理不可信输入（图片、模板 JSON、字体文件），全部走 `Result`。
- [ ] `A4 [P0]` 解码支持 JPEG、PNG、HEIF/HEIC、WebP、TIFF；输入为多帧（Live Photo 的 Motion Photo / 实况照片）时保留帧结构到输出。
- [ ] `A5 [P0]` 预览路径与导出路径共用同一份渲染代码，仅缩放因子与采样质量不同；禁止"预览一套、导出另一套"。

### B. 保真与元数据

- [ ] `B1 [P0]` 导出 JPEG 恒用质量 100 + 4:4:4 无色度下采样；导出 PNG 像素无损；**任何情况下不对图像做下采样**。
- [ ] `B2 [P0]` JPEG 输出写回清理后的 EXIF、ICC、XMP；PNG 写回机型、镜头、光圈、快门、ISO、焦距、拍摄时间、方向、最终像素尺寸。
- [ ] `B3 [P0]` **GPS 与设备序列号默认移除**，需用户在设置中显式开启才保留；导出前给出"元数据清理报告"。
- [ ] `B4 [P0]` EXIF 关键字段（机型/镜头/光圈/快门/ISO/焦距/时间）保留率 ≥ 99%，由自动化测试对 200 张样本断言。
- [ ] `B5 [P1]` 机型美化：把 EXIF 生涩代号（`ILCE-7CM2`、`X-T5`）映射为厂商官方写法（`Sony α7C II`、`Fujifilm X-T5`）；映射表为可扩展的独立数据文件，运行时可更新。

### C. 模板系统（本项目的主战场）

- [ ] `C1 [P0]` 模板是**声明式 JSON**，不是代码。结构包含 `meta` / `canvas` / `layers[]` / `fields[]` / `assets`，由 JSON Schema 严格校验。
- [ ] `C2 [P0]` 模板**不可执行任意代码、不可发起网络请求、不可读本地任意路径**；`assets` 只能引用模板包内相对路径或内置资源 ID，字体只能引用内置字体 ID 或已安装字体。校验失败即拒绝加载并给出字段级错误。
- [ ] `C3 [P0]` 字段表达式支持：EXIF 字段、常量文本、日期格式化、条件显示（如"无镜头信息时隐藏该行"）、空值兜底。
- [ ] `C4 [P0]` v1.0 内置官方模板 ≥ 60 套（8 个分类，每类 ≥ 7 套）：`classic-white`（经典白边）、`film`（胶片/齿孔）、`polaroid`（拍立得）、`gallery`（画廊卡纸）、`technical`（技术铭牌）、`magazine`（杂志/编辑）、`minimal`（极简角标）、`frame-shell`（相机壳/机身轮廓）。目标 200+ 通过模板市场社区投稿填充（见 E3，已决策 Q4），官方模板数量可随版本迭代增长。
- [ ] `C5 [P0]` 内置拼图布局 ≥ 100 种（网格拼图 + 自由拼图两类），每种布局同样以 JSON 声明，可携带 EXIF 信息条。
- [ ] `C6 [P0]` 每套模板必须提供一张由 CLI 用固定测试照片真实渲染出的样张，作为官网模板墙与黄金图基线；**禁止用设计稿冒充渲染结果**。
- [ ] `C7 [P0]` 所有模板支持整体比例调整（1:1 / 4:3 / 3:2 / 16:9 / 原图比例）与背景模糊/纯色/图片三种留白填充。
- [ ] `C8 [P1]` 模板版本化：模板有 `id` + `version` + `minEngineVersion`；引擎版本低于 `minEngineVersion` 时拒绝加载而非渲染出错图。

### D. 字体

- [ ] `D1 [P0]` 内置**可离线商用**字体子集（含中文），随安装包分发；每款字体附许可文件与子集化说明。
- [ ] `D2 [P0]` 支持按需从 Google Fonts 元数据在线下载字体并缓存到本地（1000+ 款），下载后离线可用；下载失败不影响已缓存字体与内置字体。
- [ ] `D3 [P0]` 支持加载用户本地字体文件；对缺失字形的字符给出可见告警，不静默渲染成方块。
- [ ] `D4 [P1]` 模板可声明字体回退链（如 `["Source Han Sans", "Noto Sans SC", "system"]`）。

### E. 用户模板市场

- [ ] `E1 [P0]` 用户可将当前调整保存为模板（含自定义上传的图标/水印图），导出为单文件 `.fgt`（zip 封装的 JSON + 资源）。
- [ ] `E2 [P0]` 导入 `.fgt` 前必须通过 C2 的沙箱校验；校验失败时明确告知失败字段，且不写入用户模板目录。
- [ ] `E3 [P0]` 模板市场基于独立 GitHub 仓库 `framegeist-templates`，**v1.0 即开放用户投稿**（已决策 Q5）：通过 PR 提交；CI 自动校验 Schema、渲染样张、检测与已有模板的重复度（感知哈希）；人工审核仅处理滥用与投诉，常规通过以 CI 绿为标准。
- [ ] `E4 [P0]` 客户端可浏览/搜索/一键安装市场模板；模板包与客户端版本解耦，**无需发版即可上新模板**。
- [ ] `E5 [P2]` 用户模板市场不做付费、不做分成；作者署名强制保留且不可被下游模板删除。

### F. 客户端：CLI

- [ ] `F1 [P0]` `framegeist render <photo> --template <id|path> -o <out>` 单张渲染。
- [ ] `F2 [P0]` `framegeist batch <dir> --template <id> -o <dir>` 目录批处理，重名不覆盖、先校验来源与目标位置。
- [ ] `F3 [P0]` `framegeist templates` / `framegeist probe <photo>` 列出模板与读取 EXIF。
- [ ] `F4 [P0]` CLI 是**黄金图基线的唯一生成者**：CI 用 CLI 渲染基线图，各 GUI 客户端渲染结果与之比对。

### G. 客户端：Web（浏览器）

- [ ] `G1 [P0]` 无需安装、无需登录，拖入照片即用；**照片全程在本地处理，不上传任何服务器**（WASM 内完成）。
- [ ] `G2 [P0]` 支持模板选择、实时预览、参数调整、导出下载；支持批量（浏览器内存上限内）。
- [ ] `G3 [P0]` 首屏可交互时间 ≤ 3s（4G 网络，字体按需加载）；WASM 包 gzip 后 ≤ 8MB。
- [ ] `G4 [P1]` 支持 PWA 安装与离线使用（Service Worker 缓存引擎与模板）。

### H. 客户端：Windows 桌面

- [ ] `H1 [P0]` 提供 `.exe` / `.msi` 安装包，免管理员权限安装，卸载干净。
- [ ] `H2 [P0]` 支持拖拽、文件夹批处理、系统"打开方式"关联常见图片格式。
- [ ] `H3 [P0]` 支持 200MP 以内图片导出，峰值内存 ≤ 8GB；超过内存上限时给出明确提示而非崩溃。
- [ ] `H4 [P0]` 自动更新：启动时与每 6 小时检查 `update.json`，静默下载，重启后生效；可关闭。
- [ ] `H5 [P1]` 支持作为 Lightroom / Capture One 的外部编辑器被调用（接收文件路径、回写结果）。

### I. 客户端：Android

- [ ] `I1 [P0]` 提供 APK 与 AAB 两种产物；官网直下 APK，Google Play / 国内主流商店走 AAB。
- [ ] `I2 [P0]` 支持系统分享菜单接收图片、支持从相册多选、支持"复制到"目录写入。
- [ ] `I3 [P0]` 在 8GB 内存机型上完成 108MP 照片导出不 OOM；OOM 前降级为分块渲染。
- [ ] `I4 [P0]` 更新检测：读取 `update.json`，发现新版时跳转官网下载页；**不实现静默自更新**（见 Constraints）。
- [ ] `I5 [P1]` ~~上架华为 AppGallery 与国内主流应用市场~~（已决策 Q6：**当前无开发者资质与软著，v1.0 放弃上架，Android 走官网 APK 直下侧载**）；仍需准备隐私政策与权限说明；商店上架材料延后到资质办理完成后。

### J. 客户端：HarmonyOS（原生 ArkTS）

- [ ] `J1 [P0]` ArkTS + ArkUI 原生应用，通过 NAPI 调用 `framegeist-core` 编译出的 `.so`；**不在 ArkTS 侧重写渲染逻辑**。
- [ ] `J2 [P0]` 支持 HarmonyOS NEXT 及以上；提供 `.hap` 产物与 DevEco 构建脚本。
- [ ] `J3 [P0]` 界面能力与 Android 版对齐（模板选择、批量、导出、模板市场）。
- [ ] `J4 [P1]` ~~上架华为应用市场~~（已决策 Q6：无资质，**v1.0 仅提供官网侧载说明，含开发者模式步骤**；上架延后到资质就绪后）。

### K. 官网与分发

- [ ] `K1 [P0]` 静态站点，部署于 GitHub Pages，内容含：首页、模板墙（真实渲染样张）、下载页（按平台/架构）、文档、更新日志、模板市场入口、赞助页。
- [ ] `K2 [P0]` 下载页从 GitHub Releases API 读取最新版本与校验和，**不硬编码版本号**；Release 发布后官网自动更新。
- [ ] `K3 [P0]` 官网与客户端共用一份 `update.json`（由 Release 工作流生成），保证"网页推送"与客户端更新一致。
- [ ] `K4 [P0]` 每个安装包附 SHA-256 校验值与签名指纹，官网展示。
- [ ] `K5 [P1]` 官网支持中/英双语；模板墙支持按分类筛选与搜索。

### L. 更新推送机制

- [ ] `L1 [P0]` `update.json` schema：`{ schemaVersion, channel, latest: { version, releasedAt, notesUrl, platforms: { win-x64: {url, sha256, size}, android-arm64: {...}, harmony-arm64: {...} } }, templates: { url, version, sha256 } }`。
- [ ] `L2 [P0]` 模板包独立于客户端版本推送：客户端检查 `templates` 字段，增量下载模板包，校验 SHA-256 后热加载；失败时回退到已缓存版本。
- [ ] `L3 [P0]` 发布流程：打 annotated tag `vX.Y.Z` → CI 构建四端产物 → 生成 `update.json` 与校验和 → 创建 GitHub Release → 触发 Pages 重建。**禁止手工上传产物**。
- [ ] `L4 [P0]` 支持 `stable` / `beta` 两个渠道，用户可切换；beta 不写入 stable 的 update.json。

### M. 商业模式与治理

- [ ] `M1 [P0]` **全部功能与全部模板免费**，不设账号、不设支付、不设授权校验、不设功能门禁。
- [ ] `M2 [P0]` 赞助页只列赞助渠道与致谢名单；赞助者获得官网署名、专属标识、新模板包提前 7 天获取，**不影响任何功能**。
- [ ] `M3 [P0]` 许可：代码 MIT；内置模板与字体必须为 CC0/OFL/Apache 等可商用许可，逐个附许可文件；**不得复制 frameelf 的模板资源、图标或截图**。
- [ ] `M4 [P0]` 遥测默认关闭；若提供崩溃上报，必须可关闭、匿名、不含照片与 EXIF 内容。

### N. 质量与验收自动化

- [ ] `N1 [P0]` 黄金图回归：固定 12 张测试照片（横/竖/方、含/不含 EXIF、JPEG/PNG/HEIF）× 20 套代表模板 = 240 组基线；像素差异 ≤ 0.1% 视为通过。
- [ ] `N2 [P0]` 四端一致性：CLI 生成的基线与 Windows/Android/HarmonyOS/Web 客户端渲染结果比对，同一阈值。
- [ ] `N3 [P0]` 性能门槛：24MP 预览 ≤ 300ms，24MP 导出 ≤ 2s，50 张 24MP 批量 ≤ 90s。**基准机已绑定（已决策 Q8）**：Lenovo 21J8（ThinkBook 16p G4 ABP），Intel i5-13500H（12C/16T）/ 64GB RAM / RTX 4060 Laptop / Windows 11 家庭中文版。原口径按 8 核 / 16GB 估算，此机更强，阈值视为保守下限，不得放宽。
- [ ] `N4 [P0]` 崩溃率：客户端启动 1000 次无崩溃；模板加载模糊测试 10 万次无 panic。
- [ ] `N5 [P0]` 每次 PR 必须全绿：`cargo test` + `cargo clippy -D warnings` + 四 target 构建 + Schema 校验 + 黄金图回归。

---

## Non-Goals

- **不复制 frameelf 的模板资源、图标、字体、截图或文案。** 只做功能等价，所有视觉资产必须原创或使用可商用许可素材。这是法律红线，不是偏好。
- **产品内不集成 AI 大模型。** 不做自然语言生成模板、不做场景识别推荐、不做云端推理。AI 只用于开发过程（写代码、写测试、审 PR）。
- **不做账号体系、不做支付、不做订阅、不做授权校验。** 没有"登录后同步"，没有"会员模板"。
- **不做云端存储与多端同步。** 照片、模板、设置全部本地；跨设备迁移靠导出/导入文件。
- **不做照片编辑功能。** 不裁切、不调色、不磨皮、不美颜、不做背景移除——那是 ImageToolbox / Refloow Photo Studio 的地盘。
- **不做视频处理。** 不导出视频、不做视频水印；Live Photo 只处理其静态帧与关联动图帧的封装，不做视频转码。
- **不做 iOS / macOS 客户端。** v1.0 只承诺 Windows、Android、HarmonyOS、Web。macOS 列为 v2.0 待定，iOS 明确不做。
- **不做静默自更新。** Android / HarmonyOS 走商店更新或用户确认安装，不实现后台静默替换。
- **不实现 iOS 侧 Live Photo。** 见 Open Questions 与 Constraints 的能力矩阵。
- **v1.0 不做模板市场的商业化**（无付费模板、无分成、无推荐位售卖）。
- **不做中文以外的界面本地化**（英文界面为 v1.x 目标）。

---

## Constraints

### 环境约束（本机实测）

| 工具 | 状态 | 影响 |
|---|---|---|
| git | ✅ `C:\Users\Lenovo\AppData\Local\Programs\Git\cmd\git.exe` | 可用 |
| gh CLI | ✅ 已登录 `meihuaanying`，token scopes `gist, read:org, repo` | 可建仓、推代码、发 Release |
| node / pnpm | ✅ 可用 | 官网、WASM 打包脚本可用 |
| .NET SDK | ✅ 可用 | 非必需 |
| **Rust / cargo** | ❌ **未安装** | **前置阻塞项**：必须装 rustup + MSVC 工具链 |
| **JDK** | ❌ 未安装 | Android 构建前置 |
| **Flutter** | ❌ 未安装 | 本方案不使用 |
| DevEco Studio | 未验证 | HarmonyOS 构建前置 |

### 架构约束

- **单核心原则**：渲染逻辑只存在于 `framegeist-core`。任何在客户端重复实现绘制、排版、EXIF 解析的行为都视为架构违规。
- **四端产物必须同源**：同一 commit 构建四端，版本号由根 `Cargo.toml` 单一来源，CI 校验各端版本一致。
- **模板沙箱是硬约束**：模板是数据不是代码。任何"模板里写脚本"的需求都要被拒绝。
- **Web 端零上传**：Web 版若引入任何服务端处理，即违反 G1，属于架构回退。
- **Android 更新限制**：Android 8+ 对非商店安装来源的自更新有限制，`REQUEST_INSTALL_PACKAGES` 需用户授权；因此 I4 只做"提示 + 跳转"。
- **HarmonyOS 分发限制**：非商店 HAP 安装需用户手动开启开发者模式；官网侧载说明必须写清楚，否则 J4 无法交付。
- **许可证传染性**：核心与客户端 MIT；若引入 GPL 库（如某些 HEIF 解码实现）必须隔离为可选特性并在 NOTICE 声明。
- **字体许可**：只有 OFL / Apache-2.0 / 公有领域字体可随包分发；Google Fonts 中标注为 OFL 的可用，标注为"仅限桌面使用"的不可用。

### 对标事实（frameelf 公开能力，来自官网抓取）

| 维度 | frameelf 现状 | 框灵目标 |
|---|---|---|
| 边框模板 | 200+ 预设 | 官方 60 套（v1.0）→ 200+（含市场社区投稿） |
| 拼图布局 | 100+ 布局，网格 + 自由 | ≥ 100 种，同样 JSON 声明 |
| 字体 | 1000+ Google 字体，APP 支持本地字体库 | 内置子集 + 按需下载 1000+ + 本地字体 |
| EXIF | 支持 JPG/PNG/HEIF，原图 JPG 可保留 EXIF | 支持 5 种格式，JPEG/PNG 元数据回写 |
| 批量 | 一次多图，全局改参 / 多模板 | 同 |
| 背景模糊 | 所有带框模板支持 | 模糊 / 纯色 / 图片三种 |
| 比例调整 | 所有模板支持 | 同 |
| 素材上传 | 支持自传图标 | 支持，且可保存为模板 |
| 导出 | 2K/4K/6K/原图，微信/小红书/抖音优化，桌面 200MP | 同，另加 SHA-256 校验 |
| Live Photo | iOS 全支持；Android 支持小米/OPPO/vivo/荣耀/三星等 Motion Photo 机型 | 见能力矩阵，标注待验证 |
| 平台 | 在线 + iOS + Android + PC | Web + Windows + Android + HarmonyOS |
| 保存模板 | 保存到服务器 | 保存为本地 `.fgt` 文件 + 可选上传市场 |
| 定价 | 免费 / $32.99 终身 / $19.99 年 / $9.99 季 | 全免费 |

### 同类开源项目勘察（GitHub 检索结果，2026-09）

| 项目 | Star | 栈 | 可借鉴 | 不借鉴 |
|---|---|---|---|---|
| [copicseal/copicseal](https://github.com/copicseal/copicseal) | 309 | Vue + Electron，Apache-2.0 | 单文件安装、Win/mac 双端、极简交互 | 模板数量少、无拼图、无移动端 |
| [hexergogo/lenscript](https://github.com/hexergogo/lenscript) | 1 | 纯 Rust 引擎 + 5 客户端 | **架构蓝本**：单核心、WASM/Tauri/Android、24 模板注册表、品牌 Logo 自动匹配、机型美化、JPEG 质量 100+4:4:4、GPS 默认移除、模板 Schema | 模板数量少（24）、无拼图、无 Live Photo |
| [chaoyangnz/phew](https://github.com/chaoyangnz/phew) | 8 | TypeScript + JSX→SVG + libvips | **模板即声明**的思路、CLI 批处理、Lightroom 外部编辑器集成、模糊背景变体 | 依赖 libvips 原生库分发麻烦、无 GUI |
| [T8RIN/ImageToolbox](https://github.com/T8RIN/ImageToolbox) | 高 | Kotlin/Android | Android 大图内存策略、批量与导出体验 | 功能面太宽（滤镜/OCR），不是同赛道 |
| [HuangNO1/stellar-neo](https://github.com/HuangNO1/stellar-neo) | 3 | Python + PyQt6 | 桌面端"开箱即用"的取舍 | 技术栈不可跨端 |
| [lpz7777777/PhotonWatermark](https://github.com/lpz7777777/PhotonWatermark) | 0 | TS 浏览器端 | 胶片框生成、零上传 | 仅浏览器、无移动端 |
| [shiraijikuu/camera-watermark-android](https://github.com/shiraijikuu/camera-watermark-android) | 1 | Capacitor + 单文件 HTML5 Canvas | **插件化水印**（PNG/JPG/GIF + 预设）、Android 落地方式 | 单文件内核难维护、无 Rust 级保真 |
| [Max-lu-4416/Watermark-Studio](https://github.com/Max-lu-4416/Watermark-Studio) | 7 | 纯浏览器 JS | 本地优先、PNG/文字水印 | 功能面窄 |

**结论**：lenscript 证明了"一套 Rust 引擎驱动多端"可行，但它只做 24 套模板且无拼图；frameelf 证明了大模板库 + 拼图 + Live Photo 是用户真正要的，但它闭源收费。框灵的空位就是：**Rust 单核心架构 + frameelf 级模板库 + 全免费开源 + 鸿蒙原生**。

---

## Approach

### 仓库结构

```
framegeist/
├── Cargo.toml                    # workspace，版本号单一来源
├── crates/
│   ├── framegeist-core/          # 引擎：EXIF、模板 pipeline、渲染、编码（无 OS 依赖）
│   ├── framegeist-cli/           # 黄金图基线生成器 + 批处理
│   ├── framegeist-wasm/          # wasm-bindgen 绑定（独立 workspace）
│   ├── framegeist-desktop/       # Tauri 桌面外壳（Windows）
│   └── framegeist-android/       # Tauri mobile / JNI 外壳
├── harmony/                      # ArkTS 应用 + NAPI 绑定（DevEco 工程）
├── templates/                    # 内置模板 JSON + 资源 + 样张
├── web/                          # 官网静态站 + WASM 产物
├── docs/                         # 本 PRD、架构、验收、构建手册
└── .github/workflows/            # 四端构建、黄金图回归、Release、Pages
```

### 实施顺序（每步都必须可验证后再进入下一步）

1. **环境基线**：装 rustup + MSVC 工具链 + JDK + DevEco；`cargo build` 四 target 全绿。产出 `docs/INSTALLATION.md`。
2. **引擎骨架**：`load_template` / `probe_exif` / `render` 三个 API + JSON Schema 校验 + 沙箱规则；用 3 套最小模板跑通 CLI。产出首批黄金图。
3. **模板语言定稿**：把 `canvas/layers/fields` 语义写进 `docs/TEMPLATE-SPEC.md`，并让 10 套真实模板覆盖所有字段类型。
4. **模板库扩容**：官方首批 60 套（8 个分类，每类 ≥ 7 套，见 C4），每套附 CLI 真实渲染样张；样张进官网模板墙；200+ 目标靠市场社区投稿达成。
5. **CLI 完整化**：批处理、模板列表、EXIF 探查、基线生成；作为后续所有 GUI 的验收工具。
6. **Web 客户端**：WASM + 静态页；先跑通单张，再批量、PWA。
7. **Windows 客户端**：Tauri 外壳 + 自动更新 + 大图内存策略。
8. **Android 客户端**：分享菜单、相册多选、分块渲染、商店材料。
9. **HarmonyOS 客户端**：NAPI 绑定 + ArkUI 界面 + 侧载说明。
10. **拼图模块**：网格布局 100+，再接自由拼图。
11. **Live Photo**：先做能力探测（见 Open Questions），按探测结果决定承诺范围。
12. **模板市场**：独立仓库 + CI 校验 + 客户端浏览安装。
13. **官网与发布流水线**：Pages + `update.json` + 四端 Release 自动化。
14. **黄金图回归与四端一致性**：把 N1/N2 变成 CI 必过门。

### 关键决策记录

| 决策 | 选择 | 理由 | 被否决的方案 |
|---|---|---|---|
| 核心语言 | **Rust 单核心** | 四端渲染一致性、大图性能、可编译到 WASM/Android/鸿蒙 | TS 核心（鸿蒙需重写）、Flutter（鸿蒙适配差） |
| 桌面外壳 | Tauri（Rust 原生） | 与核心同语言、包体小、自动更新成熟 | Electron（体积大、与 Rust 核心语言割裂） |
| 模板形式 | JSON 声明式 + 沙箱 | 可热更、可市场流通、安全可控 | JSX/代码模板（需执行引擎、有安全风险） |
| 模板分发 | 内置 + 远程模板包 | 免发版上新模板 | 纯内置（每次上新都要发版） |
| 更新通道 | GitHub Releases + 静态 update.json | 零服务器成本、可审计 | 自建更新服务（运维成本） |
| 商业 | 全免费 + 荣誉赞助 | 无账号/支付/授权校验，复杂度最低 | 订阅制（需支付合规与防盗版） |
| 许可 | MIT | 最宽松，利于模板市场流通 | AGPL（阻碍闭源生态）、Apache-2.0（专利条款非必需） |

---

## Open Questions

> 2026-09-09 更新：用户决策项（Q1/Q4/Q5/Q6/Q8）已全部拍板，结论写入下表；Q2/Q3/Q7 保持"需探测"，由实施阶段的最小样例验证。

- **Q1（user decision ｜ 部分待办）** 产品名最终确认：候选为 **FrameGeist / 框灵**（已倾向）、FrameKit / 画框、Exiffly、LightFrame / 光框。**已决策：先做商标检索再定名**，检索通过前一律以"FrameGeist / 框灵"为工作名（代码、仓库、文档均可用，改名只影响品牌展示层）。**待办**：中国商标网第 9/42 类检索 + WIPO/USPTO 粗查；域名决策（`framegeist.app` / `.dev` / 仅 GitHub Pages）随定名一并确认。
  - **2026-09-09 初查结果**：USPTO 数据库检索未见 "FrameGeist" 完全相同的在册商标（近邻：FRAMEGENIE-光学零售第 35 类、GEIST-服装第 25/35 类、FRAME-混合现实、FRAME.AI-数据分析，均为不同名称与不同类别，冲突风险低）。中国商标网 9/42 类仍需人工查询后定名；域名未购。
- **Q2（needs exploration）** **Live Photo 四端能力矩阵**：需实测确认 Android Motion Photo 的读写（小米/OPPO/vivo/荣耀/三星机型差异）、鸿蒙是否暴露对应 API、Windows 侧能否无损搬运帧数据。探测完成前，J/I/H 三端的 Live Photo 需求保持"待验证"，不写死承诺。
- **Q3（needs exploration → 2026-09-09 勘察有解）** **HEIF/HEIC 解码路径**：2026-09 勘察发现纯 Rust 生态已出现三条路径：① `heif-oxide`（MIT OR Apache-2.0，零 C 依赖，已解 44/63 真机 iPhone 样张，12MP 约 1s，标量实现约 5× 慢于 FFmpeg）——**许可干净，唯一可直接进 MIT 核心的路径**，但极年轻（0.1.0，下载量 49）；② `imazen/heic`（AGPL-3.0/商业双许可 + 平台原生后端）——AGPL 传染，按 Constraints 须隔离为可选特性，或花 $1 启动费买商业许可；③ `gamut-heic`（MIT/Apache，容器层成熟但 HEVC 像素解码走可插拔 hook）。**决策方向**：核心以可选 feature `heif` 接入 heif-oxide，解码失败优雅报错回退；真机 iPhone 样张集成测试后再定承诺范围。AVIF/HEIF 编码纯 Rust 生态仍无解（无需——本项目只解码）。
- **Q4（user decision ✅ 已决策）** 模板产能：**官方首批 60 套（C4 已同步）+ 模板市场社区投稿填充至 200+**。不做全原创 200 套的一次性美术投入；社区投稿走 E3 的 PR + CI 审核制。
- **Q5（user decision ✅ 已决策）** 模板市场：**v1.0 即开放用户上传**，采用 GitHub PR + CI 自动校验（Schema / 样张渲染 / 感知哈希查重）审核制；人工仅处理滥用。E3/E4 已从 P1 提升为 P0。
- **Q6（user decision ✅ 已决策）** 上架资质：**当前无企业开发者资质与软件著作权。v1.0 放弃商店上架**，Android 走官网 APK 直下 + 侧载安装，HarmonyOS 走官网侧载说明（含开发者模式步骤）；I5/J4 已改写。资质与软著办理列为独立后续任务，不阻塞 v1.0。
- **Q7（needs exploration ｜ 2026-09-09 部分推进）** **鸿蒙 NAPI 调用 Rust .so 的可行性**：已通过 winget 安装 DevEco Studio（**3.1.0.501**，仅支持 HarmonyOS 3/4 / OpenHarmony API 9-10；**HarmonyOS NEXT 需 DevEco 5.0+，winget 渠道没有，须从华为开发者站下载**）。DevEco 自带 llvm 工具链但 SDK/Native sysroot 未随附（首次建工程时才下载）。Rust 侧 `aarch64-unknown-linux-ohos` target 已可编译 rlib（见 A1）。**剩余验证**：NEXT 版 DevEco 安装 → 建 API 10+ 工程 → SDK Native sysroot + llvm 链接 cdylib → NAPI 绑定最小样例（建议直接评估 napi-rs 的 ohos 支持，避免手写 C 绑定）。阻塞点：华为开发者账号登录下载 5.x + 模拟器/真机。
- **Q8（user decision ✅ 已决策）** 验收基准机：**绑定本机 Lenovo 21J8**（i5-13500H / 64GB / RTX 4060 Laptop / Win11），规格已写入 N3。

---

## Discoveries

> 执行期发现的意外事实写在这里。格式：`日期 ｜ 上下文 ｜ 发现 ｜ 对未来工作的影响`

- **2026-09-09 ｜ 环境勘察 ｜** 本机 `git`、`gh`（已登录 `meihuaanying`，含 `repo` scope）、`node`、`pnpm`、`.NET` 可用，但 **Rust / JDK / Flutter 均未安装**。 ｜ 实施第 1 步即为环境安装，且这是唯一前置阻塞项；在此之前任何"开始写代码"的动作都会失败。
- **2026-09-09 ｜ 同类项目勘察 ｜** lenscript（Rust 单核心 + 5 客户端）已验证本方案架构可行，但其模板仅 24 套、无拼图、无 Live Photo；其 README 明确标注 iOS 待做、Android 签名需 secrets。 ｜ 架构风险低，真正的产能瓶颈在模板库规模与鸿蒙适配。
- **2026-09-09 ｜ 许可勘察 ｜** lenscript 在 NOTICE 中声明"品牌 logo 为各自商标，商用前需自行核实再分发权"，并对 HEIC 的 LGPL 履约提出法律审查建议。 ｜ 框灵的相机品牌 Logo 与 HEIF 解码必须同样处理，Q3 需法律确认。
- **2026-09-09 ｜ 用户决策 ｜** 五项 Open Questions 拍板：Q1 先商标检索再定名（检索前用工作名 FrameGeist/框灵）；Q4 官方 60 套 + 社区投稿填充至 200+；Q5 模板市场 v1.0 开放上传（PR + CI 审核制，E3/E4 升 P0）；Q6 无上架资质，v1.0 全侧载，放弃商店上架；Q8 基准机绑定本机 Lenovo 21J8（i5-13500H/12C16T/64GB/RTX 4060，实测规格与 PRD 原假设的 8核/16GB 不同，阈值保留不放宽）。 ｜ C4/E3/E4/I5/J4/N3 与 Ambiguity Report 已同步改写；剩余风险集中在 Q2/Q3/Q7 三个技术假设，全部可在"环境基线 + 引擎骨架"阶段低成本验证。
- **2026-09-09 ｜ 环境基线执行 ｜** rustc 1.98.1 stable-msvc 装好；MSVC BuildTools v18 本机已预装（免装）；JDK Temurin 17.0.20 已装。坑：winget 的 Rustlang.Rustup 包安装崩溃（0xC0000005），改用官方 rustup-init.exe。 ｜ **四 target 构建全绿**（msvc/wasm32/android/ohos）；wasm32 需 `.cargo/config.toml` 的 `getrandom_backend="wasm_js"` + feature 统一。详见 `docs/INSTALLATION.md`。A1 达成。
- **2026-09-09 ｜ 引擎骨架执行 ｜** ① crates.io 的 `exif` 是占位 crate，真身 `kamadak-exif`（lib 名 exif），需 package 重命名；其 `Writer` 在 `experimental` 模块且要求 IFD 连续非空 → 清理后的 EXIF 字段统一归入 PRIMARY IFD，由 Writer 自动合成 ExifIFDPointer。② **jsonschema 0.17 无法编译到 wasm32**（reqwest blocking 依赖）→ 引擎改为内置校验器（serde `deny_unknown_fields` + 语义校验，单实现五端一致），schema 文件保留为规格文档 `docs/schema/template.schema.json`。这是对 C1"JSON Schema 严格校验"的执行口径修正：校验强度等价，但由引擎代码而非第三方 crate 执行。③ 修复 `parse_color` 逐位十六进制 bug（`#111111` 曾渲染为近黑 [1,1,1] 而非 [17,17,17]），黄金图基线随之重生成。 ｜ 引擎骨架 + CLI（render/batch/probe/templates/hash）+ 3 套最小模板 + 36 条黄金图基线就位；19 项测试 + clippy -D warnings + 四 target 构建全绿（N5 首次全量通过）。
- **2026-09-09 ｜ 模板语言定稿 + 库扩容 ｜** ① `docs/TEMPLATE-SPEC.md` 落稿：padding 口径（left/right 相对宽、top/bottom 相对高）、九宫格锚点与偏移语义、`font.size` 相对照片高度、表达式文法（`exif.<key>` / 裸字面量常量 / `fmt` / `if_empty` / `date`，全部白名单）。② 文法补齐 C3：新增裸字符串常量、`if_empty()`、`date()`（YYYY/MM/DD/HH/mm/SS token）。③ 60 套模板由 `tools/gen-templates.mjs` 确定性生成（8 分类各 7–8 套，共 63 套含 3 手写种子），全部通过引擎校验并真实渲染。④ **样张体积教训**：q100+4:4:4 的 1600×1200 样张约 3.2MB/张，63 张 200MB 不可进 git → 样张定性为派生物（gitignore），由 `tools/gen-samples.ps1` + CI 生成并作为 artifact 上传；测试改为在内存中对每套模板跑真实渲染（C6 不可静默回退）。 ｜ C4（60 套）与 C3 达成；24 测试 + clippy 全绿。
- **2026-09-09 ｜ Q1/Q3 勘察 ｜** ① 商标初查：USPTO 无 "FrameGeist" 完全相同在册商标（近邻 FRAMEGENIE/GEIST/FRAME 类别均不同，风险低），中国商标网 9/42 类仍需人工查。② HEIF：发现 `heif-oxide`（纯 Rust、MIT/Apache、零 C 依赖）——Q3 的许可死结解除，代价是解码慢（12MP≈1s）与年轻（0.1.0）；AGPL 的 imazen/heic 仅在需要平台硬件后端时按"可选特性隔离"考虑。 ｜ Q3 从"需探索"降级为"有可行路径待集成验证"；实施第 11 步（Live Photo）前的 HEIF 集成测试据此推进。
- **2026-09-09 ｜ Web 客户端骨架 ｜** ① `framegeist-wasm`（wasm-bindgen 0.2.128）绑定三 API，wasm 产物 1.5MB（G3 预算 8MB gzip 内）；`FontBook::from_bytes` 支持内存字体注入（无文件系统的 WASM/Android/鸿蒙外壳共用）。② `web/` 静态页（拖拽/模板选择/快速预览/导出，`tools/serve.mjs` 零依赖本地服务）。③ **N2 提前达成（CLI↔Web）**：`tools/wasm-smoke.mjs` 验证 WASM 与 CLI 对同一照片+同一模板输出**字节级一致**（SHA-256 相同）。④ 模板清单由生成器产出 `web/templates.json`。 ｜ G1（零上传）/G2（单张渲染+导出）骨架达成；批量与 PWA（G4）待做。
- **2026-09-09 ｜ B2 补完 + 桌面骨架 ｜** ① PNG `eXIf` chunk 回写实现并测试通过（含 CRC32 手写实现），B2 的 JPEG/PNG 双路径关闭。② `framegeist-desktop`（Tauri 2）Windows 外壳：嵌入 `web/` 前端，release exe 8.3MB，启动验证通过；NSIS 安装包（H1）与自动更新（H4）待做。③ DevEco Studio 3.1.0.501 经 winget 装好，但 **NEXT 需 5.x（winget 无）**，Q7 最小样例阻塞在华为开发者站下载 + 设备/模拟器。 ｜ 实施顺序 1-7 全部有交付物（7 为骨架）。
- **2026-09-09 ｜ 拼图模块（第 10 步） ｜** ① 引擎新增 `load_layout` + `render_collage`（`docs/LAYOUT-SPEC.md`）：cells 比例矩形、gutter、aspect、cover-fit 填充、每格 EXIF 信息条（model_pretty + f/光圈 ISO）、输出元数据取第一张照片；`cells` 上限 25（5×5）。② CLI 新增 `collage` 命令（照片列表 + `--layout`）。③ `tools/gen-layouts.mjs` 生成 **106 套布局**（方网格 1×1–5×5 双变体、strip 2–6、hero 非对称 1+2/4/6/8、金字塔/对角线），C5 配额达成。④ 测试：配额锁、确定性（同输入两次渲染逐字节相同）、EXIF 回写、多/少照片填充、非法布局拒绝（越界/零尺寸/超 25 格/路径穿越）。 ｜ 31 测试 + clippy + 四 target 全绿。
- **2026-09-09 ｜ 官网与发布流水线（第 13 步）+ 建仓 ｜** ① 仓库 `github.com/meihuaanying/framegeist`（公开，MIT）建立并推送；CI 五 job 全绿（test/clippy/三跨 target/wasm 字节一致冒烟）。② 官网骨架上线 `https://meihuaanying.github.io/framegeist/`：首页/模板墙（真实样张 63 张）/下载页（实时读 Releases API，K2 无硬编码版本）/文档/市场/赞助页；Pages 工作流自动部署 site+web+样张。③ **Release 流水线打通（L1/L3）**：API 创建 annotated tag `v0.1.0` → CI 构建四产物（CLI zip/desktop zip/.fgpkg 模板包）→ 生成 update.json（L1 schema：platforms.win-x64/win-x64-cli + templates.count=63）+ SHA256SUMS.txt → 自动创建 GitHub Release，验证通过。④ 坑：本机 git 推送走的代理（127.0.0.1:7890）时断时续，断连时改用 GitHub Contents API 提交；gen-samples.ps1/gen-update.mjs 均需平台自适应 CLI 名。⑤ 本机 git 全局配置有 per-URL 代理条目，推送需 `-c http.https://github.com/.proxy=` 覆盖（或代理可用时直推）。 ｜ K1/K2/K3/L3 骨架达成；工程化 CI 门禁 N5 在云端跑通。
- **2026-09-09 ｜ Web 拼图 + PWA + 模糊测试 + 模板包 + 机型映射 ｜** ① **G2 拼图补全**：wasm `render_collage` 绑定 + 页面「边框/拼图」双模式（多选照片、布局清单 web/layouts.json 106 套镜像）。② **N2 口径修正（重要）**：边框渲染保持 WASM↔CLI **字节级一致**；拼图因跨目标浮点舍入存在 274/3600 万字节（max 差 3，约 0.0013% 像素）的微小差异——按 PRD N2 的 ≤0.1% 像素阈值判定通过；CLI 新增 `pixel-hash`/`pixel-diff` 命令作为跨端像素门禁的正式工具。③ **G4 PWA**：manifest + Service Worker（预缓存引擎/字体/清单，模板与布局 stale-while-revalidate）。④ **N4**：模板模糊测试 10 万次变异注入（截断/翻字节/注入 http:// file:// ../ 非法 key/NUL）零 panic、全部走 Result。⑤ **E1/E2**：CLI `template-export/-import`（.fgt zip 封装 manifest+template.json）；导入强制 C2 校验，恶意载荷（http://）被字段级拒绝且不落盘，重复 id 防覆盖。⑥ **B5**：`ModelMap` 数据文件（assets/model-map.json）覆盖/扩展内置机型映射，CLI/WASM 双端接入。 ｜ 38 测试 + clippy + 四 target 全绿。
- **2026-09-09 ｜ H1 首个安装包 ｜** tauri-cli 2.11.4 装好，`cargo tauri build` 产出 **NSIS 安装包 `FrameGeist_0.1.0_x64-setup.exe`**（含内嵌 Web UI）。H1 的 .exe 安装器口径达成（免管理员权限、卸载干净为 NSIS 默认行为）；H4 静默自更新仍待 tauri-plugin-updater + 签名密钥。
- **2026-09-09 ｜ 全面代码与产品复核（用户实机检查触发） ｜** 桌面版打开后用户报告"问题太多"。系统复盘确认 **7 个真实缺陷**，全部修复并补防回归测试：  1. **文本偏移符号 bug（最严重）**：底行公式 `H-total-off` 与模板惯用的负 y 组合后，把底锚文字推到画布外——**样张墙绝大多数模板的 EXIF 文字此前是被静默裁掉的**（q100 渲染后差异只有几千像素，人眼没检查）。修正为带符号约定（右/下向内取负），63 套模板数据统一，`TEMPLATE-SPEC §4.1` 明确语义。**根因**：黄金测试只比对哈希，从不验证"文字存在"。→ 新增 `visual_sanity.rs::bottom_text_is_visible`（9 代表模板底带非背景像素断言）永久拦截。
  2. **EXIF Orientation 完全没应用**：手机竖拍（orientation=6/8）会横躺输出。修复：解码后按 orientation 1-8 旋转像素，写出时 Orientation 归一为 1 并写 PixelX/YDimension 为最终画布尺寸（防双重旋转）。→ `orientation_is_applied` 测试（1200x900+ori6 → 900x1200）。
  3. **桌面版 CSP 杀死整个 UI**：`default-src 'self'` 同时拦截内联 `<script type=module>` 和 WASM 编译——桌面打开必然是死页面。修复：JS 外置 `web/app.js`；CSP 改 `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://api.github.com`；`dragDropEnabled: false`（否则 Tauri 原生拦截拖放，HTML5 drop 收不到文件）；Service Worker 仅在 http(s) 源注册。
  4. **预览不缩图**：A5 要求"预览与导出仅缩放因子不同"，此前只有 filter 差异——24MP 预览走全尺寸，既慢又撑爆内存。修复：`RenderOptions.max_edge`（预览 1600 上限，导出 None 全尺寸），CLI 补 `--max-edge`。→ `preview_max_edge_and_export_full` 测试。
  5. **透明 PNG 的 alpha 被丢弃变黑**：JPEG 编码前按白底预乘合成。
  6. **JPEG 边长 >65535 被静默截断成坏图**：改为明确报错。
  7. **样张墙体积**：渐变测试照在最坏情况 q100 下每张 3.2MB（共 200MB）。样张改用 `--max-edge 900`，降至 72MB 且单格下载合理。
  因 1+2+3+4 属**渲染语义变更**，黄金基线（36 条）与样张（63 张）已按修复后引擎重生成并在提交信息注明；WASM↔CLI 字节一致复验通过。
- **2026-09-10 ｜ v0.1.2 冲刺（Socratic 确认后一气呵成） ｜** 用户实机复现"卡 loading wasm、导入照片无反应"并给出视觉对标（deepseek.com/harness）。三轮 grill 后按 `AGENTS.md` 执行契约完成：
  - **T1 桌面死机三根因（全部实锤修复）**：① Tauri 的 asset CSP 改写**剥掉了 `'wasm-unsafe-eval'`**（替换为 sha256 哈希）→ WASM 编译被拦；② 早期构建注册的 **Service Worker 把 tauri 源整页缓存**（含注入 CSP 的 HTML）劫持导航，跨重启不消失；③ 模板下拉**遗留 "loading…" 占位 option 且被选中** → 拉取不存在的模板文件 → 空文本 → "invalid template JSON"。修复：`dangerousDisableAssetCspModification` + 完整 CSP、SW 在 `*.tauri.localhost` 自毁且不再注册、`fillSelect` 清占位。CDP 实测：ready、INIT OK、注入文件渲染 225ms。
  - **T2 视觉重设计（对标 harness 视觉语言，保工具布局）**：新 design tokens、大圆角卡片、渐变强调、自托管 Host Grotesk + DM Sans（OFL）、深浅两版 SVG favicon；**三态主题**（默认跟随系统，手动选择记忆，内联反 FOUC）；范围覆盖应用 + 官网 6 页。
  - **T3 双语 zh/en**：`data-i18n` 字典（K5 提前达成），默认跟随浏览器语言，选择记忆。
  - **T4 功能**：① 模板缩略图卡片选择器（63 张 240px 真实渲染缩略图 + 分类 chips + 搜索）与布局选择器（106 张生成 SVG 示意图）；② 批量导出（逐张队列下载 + 进度条）；③ EXIF 面板表格化（缺失灰显）；④ 参数微调三项（字号/内边距/文字颜色）——引擎新增 `TemplateOverrides` + wasm `render_with_overrides`，按模板 localStorage 记忆 + 重置。
  - **T5 性能硬指标（本机 WebView2 实测）**：引擎就绪 **174ms**（≤2s）；24MP 预览 **300ms**（≤600ms）、导出 **1247ms**（≤2s）；60MP 预览 **799ms**（≤1.5s）、导出 **3260ms**（≤4s）。关键优化：预览改走 **浏览器原生解码 + 引擎原始 RGBA 路径**（`render_from_rgba`，60MP 分解：解码 505ms + 引擎 79ms），该路径与字节路径**字节级一致**（回归测试锁定）。
  - **T7 发布**：v0.1.2 Release 含 CLI/桌面/模板包/update.json + **NSIS 安装包**（release.yml 新增 tauri 构建步骤，H1 进入自动化）。
  - 工程教训（已入 AGENTS.md）：黄金测试测不出"文字消失"，须像素断言；测试禁止依赖 gitignore 派生文件；CI 一旦变红先在本地复现。


---

## 附录 A：模板 JSON 草案（供 `docs/TEMPLATE-SPEC.md` 细化）

```jsonc
{
  "meta": {
    "id": "classic-white-bottom-param",
    "name": "经典白边 · 底部参数",
    "version": "1.0.0",
    "minEngineVersion": "1.0.0",
    "author": "framegeist",
    "license": "CC0-1.0",
    "category": "classic-white"
  },
  "canvas": {
    "mode": "extend",            // extend(外扩留白) | overlay(直接叠加) | cover(覆盖)
    "padding": { "top": 0.06, "right": 0.06, "bottom": 0.14, "left": 0.06 },  // 相对边长的比例
    "background": { "type": "blur", "blur": 40, "scale": 1.2 },               // blur | solid | image | none
    "radius": 8,
    "shadow": { "enabled": true, "blur": 24, "opacity": 0.12, "offsetY": 6 }
  },
  "layers": [
    {
      "type": "text",
      "id": "primary",
      "anchor": "bottom-left",   // 九宫格锚点
      "offset": { "x": 0.02, "y": -0.03 },
      "font": { "family": ["Source Han Sans SC", "Noto Sans SC"], "size": 0.028, "weight": 600, "color": "#111111" },
      "lineHeight": 1.3,
      "content": [
        { "expr": "exif.model_pretty", "fallback": "Unknown Camera" },
        { "expr": "exif.lens", "fallback": null }
      ]
    },
    {
      "type": "text",
      "id": "params",
      "anchor": "bottom-right",
      "font": { "family": ["JetBrains Mono"], "size": 0.022, "weight": 400, "color": "#666666" },
      "content": [
        { "expr": "fmt('{focal}mm  f/{aperture}  {shutter}s  ISO{iso}', exif)", "fallback": null }
      ]
    },
    {
      "type": "image",
      "id": "brand-logo",
      "anchor": "bottom-center",
      "asset": "@builtin/brand/{exif.brand_slug}",
      "size": { "height": 0.03 },
      "opacity": 0.85
    }
  ],
  "fields": {
    "exif.model_pretty": { "type": "string", "source": "exif", "transform": "model_pretty" },
    "exif.brand_slug": { "type": "string", "source": "exif", "transform": "brand_slug" }
  }
}
```

**沙箱规则（C2 的落地口径）**：`expr` 仅允许白名单函数（`fmt` / `if_empty` / `date` / `pad`）；`asset` 仅允许 `@builtin/...` 与包内相对路径；禁止 `http://`、`https://`、`file://`、`../` 跳出包目录；单模板 JSON ≤ 256KB，包内资源总量 ≤ 20MB，单张资源 ≤ 5MB。

## 附录 B：`update.json` 草案

```jsonc
{
  "schemaVersion": 1,
  "channel": "stable",
  "generatedAt": "2026-09-09T12:00:00Z",
  "latest": {
    "version": "1.0.0",
    "releasedAt": "2026-09-09T11:00:00Z",
    "notesUrl": "https://github.com/meihuaanying/framegeist/releases/tag/v1.0.0",
    "platforms": {
      "win-x64":     { "url": "https://github.com/.../FrameGeist_1.0.0_x64-setup.exe", "sha256": "...", "size": 0 },
      "android-arm64": { "url": "https://github.com/.../FrameGeist_1.0.0_arm64.apk", "sha256": "...", "size": 0 },
      "android-arm64-play": { "url": "https://play.google.com/store/apps/details?id=app.framegeist", "sha256": null, "size": null },
      "harmony-arm64": { "url": "https://github.com/.../FrameGeist_1.0.0_arm64.hap", "sha256": "...", "size": 0 },
      "web": { "url": "https://<pages>/app/", "sha256": null, "size": null }
    }
  },
  "templates": {
    "version": "2026.09.1",
    "url": "https://github.com/.../templates-2026.09.1.fgpkg",
    "sha256": "...",
    "count": 200
  }
}
```

## 附录 C：功能矩阵与需求编号对照

| frameelf 功能 | 框灵需求编号 | 优先级 |
|---|---|---|
| EXIF 边框 + 200+ 模板 | C1–C8 | P0 |
| 拼图（网格 + 自由）100+ | C5 | P0 |
| Live Photo 导出 | H2 / I1 / J3（待 Q2 验证） | P1 |
| PhotoFrame 相框 | C4（`frame-shell` 分类） | P0 |
| 保存为模板 | E1 | P0 |
| 1000+ 字体 | D1–D4 | P0 |
| 自动识别 EXIF | A4 / B1–B4 | P0 |
| 批量处理 | F2 / H2 / I2 | P0 |
| 背景模糊 | C7 | P0 |
| 整体比例调整 | C7 | P0 |
| 上传素材 | E1 | P0 |
| 多档导出（2K–200MP） | B1 / H3 / I3 | P0 |
| 多平台 | G / H / I / J | P0 |
| 账号与跨端同步 | **Non-Goal（明确不做）** | — |
| 订阅付费 | **Non-Goal（全免费）** | — |

---

## 附录 D：Ambiguity Report（`grill-me` spec 模式门禁）

```
Ambiguity Report:
  Goals:        0.25  ✓ 可区分“做完/快做完”
  Acceptance:   0.25  ⚠ 基准机未绑定
  Boundaries:   0.00  ✓ 清晰
  Alternatives: 0.00  ✓ 已比较并给出否决理由
  Assumptions:  0.50  ⚠ 四处待验证假设
  ──────────────────────────────
  Aggregate:    0.20  ✓ 正好压线（0.2 spec 阈值）

Push lightly on: assumptions (鸿蒙 Rust 链路 / HEIF 解码 / Motion Photo / 上架资质).
```

**待压测的假设（对应 Open Questions，2026-09-09 决策后更新）**

| 假设 | 若为假的后果 | 验证方式 | 对应问题 | 状态 |
|---|---|---|---|---|
| Rust `.so` 可被鸿蒙 ArkTS 通过 NAPI 调用 | J 组需求全部推倒，鸿蒙需重写渲染层 | 最小样例：ArkTS 调 Rust 函数并返回大图 | Q7 | 待验证（实施第 1 步后立即做） |
| HEIF 可通过可用许可的路径解码 | A4/B1 在 iPhone 照片上失效，Web 端尤甚 | 调研 libheif（LGPL）与系统解码，做许可与体积评估 | Q3 | 待验证 |
| Android Motion Photo 可读可写 | I 组 Live Photo 承诺收缩到部分机型 | 在小米/OPPO/vivo/荣耀/三星各一台实测 | Q2 | 待验证 |
| ~~具备 AppGallery / 国内商店上架资质~~ | ~~Android/HarmonyOS 长期只能官网侧载~~ | —— | Q6 | **已消除**（决策：无资质，v1.0 明确走侧载，不再是假设而是既定路径） |
| "FrameGeist / 框灵"可用作最终品牌名 | 品牌展示层需改名（不影响代码与仓库结构） | 商标检索（中国商标网 9/42 类 + WIPO/USPTO） | Q1 | 待办（检索通过前用工作名） |

**门禁结论**：聚合 0.20 达到 spec 阈值（0.2），可进入执行。Q6 决策后 `Assumptions` 由 0.50 降至约 0.25（仅剩鸿蒙链路 / HEIF / Motion Photo 三项技术假设，均可在引擎骨架阶段低成本证伪）——**这四个假设中任意一个为假，都会改变交付范围**。因此执行顺序刻意把"环境基线 + 引擎骨架"排在前面，让最贵的假设（鸿蒙链路）在模板库扩容之前就被证伪或证实。
