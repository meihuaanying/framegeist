# AGENTS.md — FrameGeist 执行契约（每次会话开始必读）

> 优先级：**PRD 红线 > 本文件 > 保守默认**。遇未预见决策自主推进并记入 PRD Discoveries，不打断用户。

## 项目一句话

FrameGeist（框灵）：免费开源照片边框/水印/拼图工具。一个 Rust 核心（`framegeist-core`）驱动 CLI/Web/Windows/Android/HarmonyOS，同一模板四端像素级一致。PRD 见 `docs/prds/framegeist.md`。

## 不可违背的红线

1. G1 零上传（照片/模板/数据不出本机）；2. A2 单核心（渲染逻辑只在 core）；3. C2 模板沙箱；4. B3 GPS/序列号默认剥离；5. M1 全免费；6. 不复制 frameelf 资产/文案；7. 许可证合规（代码 MIT，资产 OFL/CC0/Apache）；8. Non-Goals（照片编辑/视频/iOS/账号云同步/AI 推理）。

## 工程铁律（历史教训）

- 提交前必须本地 `cargo test --release --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` 全绿；禁止提交未编译代码。
- 每个修复带回归测试；**视觉修复必须带像素断言**（黄金图只测哈希，测不出"文字/图片消失"）。
- 测试禁止依赖 gitignore 派生文件（CI 干净检出）；一律内存合成。
- Tauri：CSP 需 `dangerousDisableAssetCspModification: true` 且显式含 `'wasm-unsafe-eval'`（Tauri 会改写 CSP 剥掉它）；`dragDropEnabled: false`；SW 仅 http(s) 且非 `*.tauri.localhost`。
- wasm-bindgen-cli 版本严格等于 crate 版本（0.2.128）。
- kamadak-exif：`exif = { package = "kamadak-exif" }`；Writer 在 `experimental`；字段归一 PRIMARY；Exif 子 IFD = `In(2)`。
- PowerShell 5.1 转义陷阱 + bash/PowerShell 混合 shell：改代码一律用 edit 工具；提交信息用 `-F 文件`；避免 `$`/反引号/`#` 在组合命令里。
- 本机 git 代理（127.0.0.1:7890）时断时续：`git -c "http.https://github.com/.proxy=" push`，失败重试或走 `gh api` Contents PUT。
- CRLF 警告可忽略；误提交无关文件立即 `git rm --cached`。

## v0.4.0 执行契约（2026-09-12 已完成 ✅）

> 结果：**184 套 / 25 分类**（166 套新设计 + 18 套游戏）；引擎 A1–A9 全落地（字距/旋转/透明度/形层/色卡/tint/圆角投影/GPS/25 分类）；模板墙 → 编辑器主导流程 + 11 张真实摄影；**E2E 57/57**（≥45 门禁）；cargo test/clippy/WASM 字节一致全绿；性能 24MP 预览 231ms、24MP 导出 0.69s、60MP 导出 1.27s。报告与截图 `docs/reports/v0.4.0/`。发布（push/tag/Release/Pages）待执行。

> 目标：**design-first 大版本**。① 学习 frameelf 后把**全部模板推倒重做**（原创构图，子 Agent 分工设计，180+ 套）② 应用改为**模板墙 → 编辑器**主导流程 ③ 预览图换**真实摄影** ④ 引擎补齐设计语言所需能力（字距/旋转/色卡/圆角投影/形层/GPS/日历）。
> 设计语言规范：`docs/DESIGN-LANGUAGE.md`（子 Agent 必读）。研究语料在临时目录，**严禁入仓**。

### 用户确认的决策（2026-09-12 指令 + 前次 grill）

1. **frameelf 深研**：已下载桌面版（Pake 套壳→Web），逐类研读 22 分类 217 套；蒸馏成 DESIGN-LANGUAGE.md。**只学语言，不抄版式/资产/文案**（红线 6 不破）。
2. **全部模板重做**：现有 130 套（含自研 63 + frameelf 对标 37 + 开源灵感 12 + 游戏 18）全部重新设计与实现；目标 **180+ 套 / 24+ 分类**（对齐 frameelf 生态分类，用户找得到熟悉的类目）。游戏 18 套保留定位，按新引擎能力精修。
3. **子 Agent 分工设计**：指定子 Agent（Task/general）按分类分组产出模板 JSON；每套必须 CLI 真实渲染自检 + QA 清单通过；主 Agent 负责集成、视觉审计、修复派单。
4. **UI 重构**（前次 grill 已确认）：先选模板 → 再导照片；**全屏模板墙**（顶栏 + 横向分类 tabs + 搜索 + 响应式大卡 + hover 使用/放大镜）；**编辑器 = 顶栏 + 大预览 + 右侧手风琴面板**（模板/照片/画布/文字/Logo/导出）。
5. **真实摄影预览**：预览/样张/缩略图从博物馆画作换成真实摄影（picsum/CC0），按分类映射；CREDITS 记录；640px Lightbox 图保留。
6. **配色不变**：知乎蓝 `#1772F6 → #50C8FD`，禁紫扫描保留。游戏模板保持"原创字标 + 用户上传位"，零官方素材。

### 引擎 v0.4.0 特性（T-A，先于模板设计冻结规格）

- **A1 字距**：`TextLayer.letterSpacing`（em 倍率，-0.05–0.5，默认 0）——微排版刚需。
- **A2 旋转**：`TextLayer.rotation` 与 `ShapeLayer.rotation`（度，-360–360，绕自身锚点）。
- **A3 不透明度**：`TextLayer.opacity`（0–1，水印层用）。
- **A4 形层**：`type:"shape"`（line/rect/ellipse；size 相对照片宽高；color/opacity/radius/rotation）——分隔线/圆点/色块/双线框。
- **A5 色卡层**：`type:"palette"`（k-means 主色提取，count 3–8，shape circle/square/diamond/hexagon/strip，direction，size/gap，showHex+字体）——色卡/ColorWalk 差异化。
- **A6 画布圆角/投影**：实现既有 `canvas.radius`/`canvas.shadow`（当前仅校验未渲染）。
- **A7 底色**：`background.type:"tint"`（照片主色铺底，ColorWalk 无缝延伸；可 `color` 覆盖）。
- **A8 新表达式**：`exif.gps_lat/gps_lon/gps_latlon/gps_alt`（格式化 DMS/米）、`exif.weekday_cn`、`date` 新增 `WW`（Wednesday）/`MMM`（Aug）token。
- **A9 分类枚举扩展**：25 值（white-border / camera / phone / drone / fuji / film / colorwalk / colorful / classic-watermark / portfolio / black-frame / sports / calendar / magazine / minimal / borderless / master / personal / polaroid / festival / effect / colorcard / blur-bg / ticket / game）；旧值迁移映射 classic-white→white-border、frame-shell→camera、gallery→portfolio、technical→classic-watermark、其余同名保留。
- 同步更新 `docs/TEMPLATE-SPEC.md` + `docs/schema/template.schema.json` + 回归测试（每特性像素/结构断言）。

### 原创资产（T-B，gen-frame-assets.mjs 扩展）

35mm 齿孔条（横/竖）、胶片边码条、邮票齿孔、票卡缺口、原创条码、朱文印章（方/圆）、自创图标（龙舟/灯笼/山峰/相机/无人机/电影）、细线/双线装饰、纸纹噪点（可选）；品牌/系列/游戏字标按需扩 slug。全部 resvg 生成、CC0、可追溯。

### 模板重做工作流（T-C，子 Agent 波次）

1. **冻结**：引擎 A1–A9 落地 + TEMPLATE-SPEC 更新 + release CLI 预编译 + `tools/validate-templates.mjs`（schema+语义+沙箱预检）就绪。
2. **派单**：按分类分组派 6–7 个子 Agent（每组 3–4 分类 / 20–30 套），任务书 = DESIGN-LANGUAGE.md + TEMPLATE-SPEC + 2 套黄金范例 + QA 清单；产出到 `templates/`（扁平 `<category>-<variant>.json`）。
3. **自检**：子 Agent 必须 `validate` + CLI `render` 真实照片 + 肉眼审查（可读 render 图）+ 至少一轮自修，附自检摘要。
4. **集成**：主 Agent 全量重渲染（gen-samples 三档：samples 900 / previews 640 / thumbs 240）+ 分类接触表视觉审计 + 相邻差异断言（>3%）。
5. **修复**：不合格模板派修复 Agent 或主 Agent 直改；重复达到全绿。
6. **旧模板清理**：130 旧 JSON 全部删除替换（黄金基线按语义变化重生成并注明）；`web/templates.json` 重建。

### UI 重构（T-D）

- **模板墙**：首屏全屏；顶栏（logo/搜索/语言/主题/设置/导入）；分类 tabs 横向滚动；卡片 = 真实摄影预览 + 名称 + 分类 chip + hover「使用/放大镜」；响应式 2–4 列；骨架屏/懒加载/微动画沿用 v0.2 契约。
- **编辑器**：顶栏（返回模板墙/模板名/导出/设置）+ 中央大预览（自适应 contain、缩放/平移/翻转保留）+ 右侧手风琴（模板/照片/画布/文字/Logo/导出预设）；导入照片后自动渲染；无照片时显示模板占位预览。
- **真实预览**：`templates/assets/photos/` 换真实摄影（≥8 张，含横/竖/方/夜/人像/建筑），gen-samples 分类映射更新；web/photos 镜像。
- i18n（zh/en）与既有设置/Lightbox/批量/EXIF 编辑器全兼容；`fg-settings-v1` 不破坏。

### 门禁与发布（T-E）

- `cargo test --release --workspace` + clippy -D warnings + 四 target + wasm smoke 全绿。
- E2E `tools/e2e-audit.mjs` ≥45 断言：新增模板墙布局指标、编辑器布局指标、分类 tabs、180+ 模板配额/双语/分类枚举、色卡像素断言、字距/旋转像素断言、真实预览图存在性、无紫扫描保留。
- 性能维持 v0.3 基线（24MP 预览 ≤600ms/导出 ≤2s）。
- 版本 0.4.0；Release 含 CLI/桌面/模板包/update.json/NSIS；Pages 在线验证；报告归档 `docs/reports/v0.4.0/`。
- 收尾：PRD Discoveries + 本契约状态更新 + 桌面重启。

### 红线补充

- frameelf 研究语料（预览图/API 响应/接触表）**不入仓、不进 Release、不二次分发**。
- 模板不得与 frameelf 版式 1:1 对应；命名与文案全部自创（禁止照抄 "The Master Watermark / MASTER PHOTOGRAPHY / TICKET STUB" 等原句用作模板名或固定文案时可保留通用词组合的原创变体，但禁止逐字复制其完整文案）。
- 子 Agent 禁止访问 frameelf 研究语料目录；只读 DESIGN-LANGUAGE.md/TEMPLATE-SPEC 与本契约（避免诱导复刻）。

## v0.3.0 执行契约（2026-09-12 已完成 ✅）

> 结果：39/39 E2E 全绿；130 套模板；禁紫蓝系；Logo 三层根因修复+像素断言；自动对比度；设置页；Lightbox；11 款字体；游戏 18 套（原创字标+免责声明）。报告见 `docs/reports/v0.3.0/`。

> 优先级仍为：PRD 红线 > 本文件 > 保守默认。遇未预见决策自主推进并记入 PRD Discoveries。

### 用户确认的决策（三轮 grill）

1. **禁紫**：全局移除紫色。采用知乎实采蓝系：`--accent-a #1772F6 → --accent-b #50C8FD`（蓝→浅蓝渐变），底 `#F8F8FA`、深灰字 `#373A40`、辅橙 `#FB6622`；深色模式同色系降亮。应用 + 官网 + favicon 全覆盖。
2. **预览照片**：6 张（3 风光 + 3 建筑），来源 Met/Cleveland CC0 + picsum（已测可达），入仓并记 CREDITS；**按分类映射**（风光→film/minimal/technical，建筑→classic-white/gallery/magazine/frame-shell，游戏按主题选）；缩略图/样张分类轮换。新增 **640px 预览图**（web/previews/）供 Lightbox。
3. **模板扩容 → 130 套**（63+67）：frameelf 对标 37（相机相框 8 / 手持 5 / 镜头图标 4 / 胶片加强 6 / 无边框 6 / 签名 4 / 壳体 4）+ 游戏 18（6 游戏 × 3）+ 开源灵感 12（frosted/gallery-noir/expo×3/card×3/instax/wordmark/postmark）；后续迭代 200+。全部走引擎校验 + CLI 真实样张 + 缩略图。
4. **游戏主题**：使用对应游戏的设计语言原创视觉；名称 = 游戏名+元素名（中英双语 `meta.nameI18n`）；随包仅 **原创字标**（`@builtin/game/<slug>`，resvg 生成）+ 用户上传位；**禁止随包任何官方素材**；模板加"非官方"免责声明字段。
5. **Logo/相框资产补全**：补品牌缺口（GoPro/Phase One/OM System 等可得即加）；**镜头系列徽章**（GM/L/S/Art/DG DN/XCD/XF，原创字标 + 自动识别 `exif.lens_series`）；**手持相机相框**与**机身轮廓增强**（原创矢量 → resvg 栅格化）；节庆素材本次不做。
6. **修复 Logo 不显示的三个根因**：① 引擎 `@builtin/` 路径双重 `brand/` 拼接 bug；② Web/WASM 端由 UI 按需 `fetch(./brand/<slug>.png)` → `register_asset`（含 -light 变体）；③ 徽章覆盖扩大到全部适配分类；④ **E2E 增加徽章像素断言**（修我 0.2.0 只断言文字的漏洞）。
7. **自动对比度**（全自动 + 可覆盖）：引擎对每个文本层采样文字区域背景平均亮度——保持模板色，若对比度 < 2.5:1 自动切黑/白较优者；支持 `color:"auto"`；品牌徽章按背景亮度自动选黑/白变体（`autoTint` 默认开）；用户手选颜色 < 3:1 时 UI 警告但不阻止。
8. **Lightbox 双通道**：有照片时单击缩略图=应用；缩略图放大镜按钮=大图预览；无照片时单击=大图预览（含"应用"按钮、←/→、ESC）。
9. **设置页**：顶栏齿轮 + `Ctrl+,` 打开对话框式面板；模块：导出默认值 / 文字与 Logo 默认值 / 外观与语言 / 隐私与元数据（GPS 默认关）/ 本地数据管理（逐项清空 + 存储占用统计）/ 关于与许可 / 桌面专有（保存方式可切、更新通道）。默认值影响新会话；存储 `fg-settings-v1`。
10. **字体补两款**：Great Vibes（签名体）+ Ma Shan Zheng（中文书法，GB2312 子集），OFL；引擎字体共 11 款。
11. **验收**：E2E 断言扩到 ≥30 项（新增：**无紫色扫描**、**徽章像素**、**自动对比度**、**Lightbox 交互**、**设置持久化**、130 套配额/双语名/游戏分类）；性能维持（启动 ≤2s、24MP 预览 ≤600ms/导出 ≤2s、60MP 预览 ≤1.5s/导出 ≤4s）。
12. **发布 v0.3.0**：Release 含 CLI/桌面/模板包/update.json/NSIS；Pages 验证。

### 任务分解（执行顺序）

- **T-A 修 Logo 链路**：引擎路径 bug 修复（`@builtin/brand/x` → `assets_dir/brand/x.png`）+ 单元测试像素断言；UI `ensureBrandAssets(slugs)` 按需注册；模板生成器徽章覆盖扩展。
- **T-B 配色替换**：web/styles.css + site/site.css + favicon + manifest 主题色；E2E 扫描无紫断言。
- **T-C 自动对比度**：引擎实现（文本层对比度修正 + `auto` 色 + 徽章 autoTint）+ 单测；UI 手选色警告。
- **T-D 照片与预览资产**：fetch 6 照片（Met/Cleveland/picsum + CREDITS）→ 分类映射；gen-samples 输出 samples(900)/thumbs(240)/previews(640) 三档 + web 镜像；Lightbox UI。
- **T-E 设置页**：面板 UI + 全部模块 + 持久化 + 桌面保存方式切换（system dialog / downloads）。
- **T-F 模板扩容 67 套**：gen-templates v2 分类/双语名/免责字段；gen-game-templates.mjs（6×3）；gen-frame-assets.mjs（手持/机身/胶片齿孔/节庆略/系列徽章/游戏字标）；新字体下载+子集；全部校验+样张+缩略图；配额断言 ≥130。
- **T-G UI 补齐**：游戏分类 chip、系列徽章开关、Lightbox、品牌面板扩展、模板名双语、模板放大预览 hover。
- **T-H 门禁**：cargo test/clippy/四 target/wasm smoke/E2E ≥30 断言/性能；黄金基线仅在语义变化时重生成（注明）。
- **T-I 发布**：v0.3.0 bump → push → CI → tag → Release → Pages 验证。
- **T-J 收尾**：桌面重启；PRD Discoveries + 本文件状态；报告截图归档 `docs/reports/v0.3.0/`。

### 红线补充

- 游戏模板**不得随包官方素材**（Logo/立绘/图标），只允许原创字标与用户上传；模板 meta 须含"非官方"声明。
- 色彩禁用清单：`#a06bff #8b5cf6 #7c3aed #9b5cff` 及任何紫色系；E2E 扫描强制。



> 结果存档：**23/23 E2E 门禁通过**（`tools/e2e-audit.mjs`），报告与截图在 `docs/reports/v0.2.0/`。
> 交付：固定视口编辑器（缩放/平移/翻转）、NASA 公有领域演示图重渲染缩略图与样张、
> 18 品牌 Logo（Simple Icons CC0 + 自绘字标）、9 款 OFL 字体 + 上传、画布比例/背景面板、
> EXIF 行编辑器 + 保存/导入 .fgt、批量导出、导出预设（不裁切）、整套微动画（View Transitions +
> 骨架屏 + `prefers-reduced-motion`）、引擎错误码双语、HEIC 明确文案。
> 关键实测：画布覆盖率 87.1%、页面零滚动、引擎就绪 ~0.5s、24MP 预览 186–582ms、拼图 0.9–1.7s。
> 排障记录：CDP 注入必须用绝对路径（相对路径触发 `NotReadableError`）；品牌图标在 Web/WASM
> 端因无文件系统而留白属预期（UI 后续可直接 register_asset 注入）。

<details><summary>v0.2.0 历史任务清单（已完成，23/23 E2E 通过，见 PRD Discoveries）</summary>

### 用户确认的 20 项决策（全部已 grill）

1. **演示素材**：4 张 CC0 真实照片（横/竖/方/夜景）入仓；缩略图统一用横构图渲染；官网样张横竖轮换；`docs/CREDITS.md` 记录来源与许可。
2. **品牌 Logo**：Simple Icons（CC0-1.0）下载 + Node 端 rasterize 为 PNG；模板内 Logo 位 + 水印行前置图标 + 镜头识别映射 + 自定义上传 Logo + 全局开关，默认开。
3. **Logo 缺失行为**：无匹配留白，不显示通用图标（不假装）。
4. **布局**：固定视口双栏（左栏独立滚动 + 操作按钮常驻可见 + 画布 contain 自适应）；滚轮缩放/双击复位/拖拽平移；水平/垂直翻转。
5. **选择器**：两档可切（紧凑 2 列 / 大图 1 列）；统一 3:2 画布对齐；分类 chips + 搜索；**当前选中模板永远可见**（修复"选 classic 渲染出 shell"的状态不可见坑）。
6. **比例与背景**：比例 1:1 / 4:3 / 3:2 / 16:9 / 9:16 / 原图；背景 模糊/纯色（取色器）/图片/无。
7. **字体**：内置 9 款（中文：思源黑体/思源宋体 3500 常用字子集；英文：Inter/Playfair Display/Bebas Neue/Oswald/Cormorant Garamond/Space Grotesk + 现有 JetBrains Mono；UI 现有 Host Grotesk/DM Sans）+ 本地上传（IndexedDB 持久化）+ 字体选择器（引擎 overrides）。
8. **批量增强**：统一面板应用全部（模板/比例/背景/微调/字体/Logo 开关），每张各自读 EXIF。
9. **导出预设**：原图/6K/4K/2K/自定义长边，**不裁切**（保持比例，最长边限制）。
10. **EXIF 编辑器 + 保存模板一体**：编辑当前模板文字行（字段插入/删除/拖排序/自定义文字/实时预览）；保存为 .fgt（Web 下载 + IndexedDB 保存；桌面系统保存对话框）。
11. **微动画全套**：缩略图懒加载渐显+悬停、切换过渡（View Transitions API）、主题过渡、渲染骨架/淡入、微交互（按钮/toast/进度）、首屏骨架、尊重 `prefers-reduced-motion`。动效契约 120/180/240/520ms + `cubic-bezier(0.16,1,0.3,1)`。
12. **E2E 门禁固化**：`tools/e2e-audit.mjs`（CDP 真机全旅程 + 布局指标断言 + 性能阈值 + 截图归档），发布前必跑。
13. **桌面落盘**：系统保存对话框（Tauri dialog invoke + 自定义 `save_file` command；`withGlobalTauri: true`），Web 端浏览器下载。
14. **导出命名**：`原名-模板名.jpg`；批量重名自动加序号防覆盖。
15. **HEIC**：文案修正（引擎不支持时明确提示"HEIC 暂不支持，见路线图"，不静默失败）。
16. **错误文案双语**：引擎 Error 增加 `code()`；wasm 以 JSON `{code,message}` 抛出；UI 按 code 本地化。
17. **版本**：v0.2.0，Release 含 NSIS。
18. **排除项（本次不做）**：日历、Colorwalk、Live Photo、云同步（永不做）、HEIC 解码、Android/鸿蒙客户端。
19. **布局验收硬指标**：1440×900 下画布覆盖率 ≥85%、成品图完整可见（页面不滚动）、操作按钮首屏可见。
20. **性能验收**：引擎就绪 ≤2s；24MP 预览 ≤600ms / 导出 ≤2s；60MP 预览 ≤1.5s / 导出 ≤4s（本机基准，实测归档）。

### 任务分解（执行顺序）

- **T-A 资产**：CC0 照片 4 张 + CREDITS；Simple Icons 品牌 PNG（gen-brand-assets.mjs，@resvg/resvg-js，devDependency）；9 款字体下载 + 中文子集（fonttools，缺失则 pip 安装）；`templates/assets/fonts/fonts.json` 清单（family/file/license）；OFL/许可文件齐全。
- **T-B 引擎**：图片层渲染（asset map/内置 brand/PNG 解码/尺寸/锚点/透明度）；`attach_to` 文本行前置图标；asset 路径表达式（`{exif.brand_slug}`/`{exif.lens_slug}`）与沙箱校验；`brand_slug`/`lens_slug` 映射（make/lens 前缀→slug，可数据文件覆盖）；`TemplateOverrides` 扩展（aspect/background/background_color/flip/font_family/show_logo）；比例扩画布 + 背景填充（模糊/纯色/图片）；翻转；字体 override；`Error::code()`；回归测试（图片层像素、attach 位置、比例尺寸、翻转、slug 映射、错误码）。
- **T-C WASM**：新 API（assets 数组、字体注册/懒加载、override JSON 全字段、错误 code JSON）。
- **T-D 生成器**：模板生成器为 frame-shell/technical/minimal 增加品牌徽章层（种子模板保持不变以稳基线）；gen-samples 用 CC0 横图 + 3:2 统一缩略图；官网样张 4 图轮换；layout-thumbs 保持。
- **T-E Web UI（重写）**：固定视口布局 + 缩放/平移/翻转；双档选择器；选中可见性；画布面板（比例/背景/翻转）；字体选择器 + 上传；Logo 面板（开关/按 EXIF 覆盖/上传）；批量面板 + 进度；导出预设；EXIF 编辑器 + 保存模板（store-only zip 写/读，自实现 CRC32）；错误码本地化；微动画全套；H4 更新检查保留。
- **T-F 桌面**：withGlobalTauri + `save_file` command + dialog invoke；重建；CDP 验证".
- **T-G 工具**：`tools/e2e-audit.mjs`（含断言）；`tools/make-perf-photos.ps1` 保留；serve.mjs 别名扩展（brand/fonts）。
- **T-H 门禁**：test/clippy/四 target/wasm smoke/E2E/性能；黄金基线仅在默认渲染变化时重生成（注明）。
- **T-I 发布**：v0.2.0 bump → push → CI 绿 → tag → Release（CLI/桌面/模板包/update.json/NSIS）→ Pages 验证（新缩略图/品牌素材/双语/双主题）。
- **T-J 收尾**：桌面重启交用户；PRD Discoveries + 本契约状态更新；E2E 截图与性能数字归档到 `docs/reports/v0.2.0/`。

</details>

### 验收总门（全部满足才算完）

1. E2E 门禁全绿（含 19 项布局硬指标 + 20 项性能指标 + 全旅程无死路）。
2. 63 模板缩略图肉眼可区分（相邻同分类像素差异 >3%，自动断言）。
3. 品牌 Logo：Sony/Nikon/Canon/Fujifilm 等 ≥8 品牌可用，无匹配留白，开关生效。
4. 双主题 + 双语 + 微动画全覆盖，reduced-motion 生效。
5. 本地与云端 CI 全绿；v0.2.0 Release 含 NSIS；Pages 在线可用。
6. PRD 与本文件同步；E2E 报告与性能实测归档。
