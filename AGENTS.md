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

## v0.2.0 执行契约（2026-09-11 已完成 ✅）

> 结果存档：**23/23 E2E 门禁通过**（`tools/e2e-audit.mjs`），报告与截图在 `docs/reports/v0.2.0/`。
> 交付：固定视口编辑器（缩放/平移/翻转）、NASA 公有领域演示图重渲染缩略图与样张、
> 18 品牌 Logo（Simple Icons CC0 + 自绘字标）、9 款 OFL 字体 + 上传、画布比例/背景面板、
> EXIF 行编辑器 + 保存/导入 .fgt、批量导出、导出预设（不裁切）、整套微动画（View Transitions +
> 骨架屏 + `prefers-reduced-motion`）、引擎错误码双语、HEIC 明确文案。
> 关键实测：画布覆盖率 87.1%、页面零滚动、引擎就绪 ~0.5s、24MP 预览 186–582ms、拼图 0.9–1.7s。
> 排障记录：CDP 注入必须用绝对路径（相对路径触发 `NotReadableError`）；品牌图标在 Web/WASM
> 端因无文件系统而留白属预期（UI 后续可直接 register_asset 注入）。

<details><summary>原始任务清单（T-A … T-J）</summary>

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
