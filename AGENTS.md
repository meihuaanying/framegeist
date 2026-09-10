# AGENTS.md — FrameGeist 执行契约（每次会话开始必读）

> 本文件是给 AI 执行者的硬约束。优先级：**PRD 红线 > 本文件 > 保守默认**。
> 当前执行契约版本：2026-09-10（v0.1.2 换皮+修死+功能冲刺）。

## 项目一句话

FrameGeist（框灵）：免费开源的照片边框/水印/拼图工具。一个 Rust 核心（`framegeist-core`）驱动 CLI/Web/Windows/Android/HarmonyOS 五端，同一模板四端像素级一致。PRD 见 `docs/prds/framegeist.md`。

## 不可违背的红线（违者即回滚）

1. **G1 零上传**：照片、模板、任何用户数据不得离开本机。Web 端引入任何服务端处理 = 架构回退。
2. **A2 单核心**：渲染/EXIF/排版逻辑只存在于 `framegeist-core`，客户端壳不得重复实现。
3. **C2 模板沙箱**：模板是数据不是代码；禁止 http/file/路径穿越/非白名单表达式。
4. **B3 GPS 与序列号默认剥离**，显式开启才保留，导出必须给清理报告。
5. **M1 全免费**：不设账号/支付/授权校验/遥测默认开。
6. **不复制 frameelf 的任何资产/文案/截图**。
7. 全站 MIT；字体/模板仅 OFL/Apache/CC0。
8. Non-Goals 不做：照片编辑、视频、iOS/macOS、账号云同步、AI 推理。

## 工程铁律（历史教训，违者返工）

- **提交前必须本地跑过**：`cargo test --release --workspace` + `cargo clippy --workspace --all-targets -- -D warnings`。禁止提交未编译/未通过的代码（已发生并被 CI 抓过两次）。
- **每个 bug 修复必须带回归测试**；每个视觉修复必须带像素断言（`visual_sanity` 模式），黄金测试只比对哈希，**测不出"文字消失"这类问题**。
- **测试禁止依赖 gitignore 的派生文件**（test-photos/samples）——CI 干净检出没有；一律内存合成。
- 桌面 CSP 必须：`script-src 'self' 'wasm-unsafe-eval'`；`dragDropEnabled: false`；Service Worker 仅在 http(s) 源注册。
- wasm-bindgen-cli 版本必须严格等于 crate 版本（当前 0.2.128）。
- kamadak-exif：crate 名是 `exif = { package = "kamadak-exif" }`；Writer 在 `experimental`；字段归一 PRIMARY IFD；Exif 子 IFD = `In(2)`。
- PowerShell 5.1 转义陷阱：raw string 里 `"#` 会截断、反引号/`${` 会炸解析——改文件一律用 edit 工具，不用 PS 正则替换多行代码。
- 本机 git 推送代理（127.0.0.1:7890）时断时续：`git -c http.https://github.com/.proxy= push`，反复失败改用 `gh api` Contents PUT。
- 黄金基线/样张重生成必须注明原因（渲染语义修复 ≠ 随意刷新）。
- 模板 offset 带符号约定：**右/下锚点向内 = 负值**（spec §4.1），回归测试 `visual_sanity::bottom_text_is_visible` 锁死。

## 当前执行契约（本次一口气完成，中途不停）

> 遇未预见决策：按 红线 > 本文件 > 保守默认（不加范围、不改架构）自主推进，全部记入 PRD Discoveries，不打断用户。

- **T1 修桌面/Web 加载死机**（用户实机复现：状态卡 "loading wasm…"，模板/布局永远 loading，导入照片无任何反应）
  - 用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动桌面版，CDP 实取 console 错误，定位根因（疑似：Tauri 自定义协议下 wasm 流式实例化/资源 MIME/相对路径）。
  - 验收：引擎就绪 ≤2s；**任何**加载/渲染失败必须在 UI 显示具体错误文案（不允许无限 loading / 无反馈）；导入照片后立即显示原图缩略预览（不等渲染）。
- **T2 视觉重设计（对标 deepseek.com/harness 的视觉语言，保工具布局）**
  - design tokens（CSS 变量）+ `data-theme` 三态：浅色 / 深色 / 跟随系统（默认），手动选择存 localStorage；无闪烁（内联判定脚本需过 CSP——放行 `script-src` 所需，或改外置早执行）。
  - 深/浅两套完整色板、大圆角卡片、渐变强调、自托管 Host Grotesk + DM Sans（OFL，SW 预缓存）、深浅两版 SVG favicon/logo。
  - 范围：`web/`（应用，桌面内嵌同一套）+ `site/` 全部 6 页。
- **T3 双语 zh/en**：`data-i18n` + 字典 JS，顶栏切换，默认跟随浏览器语言，选择记忆；应用 + 官网全套（K5 提前完成）。
- **T4 功能**
  - T4.1 模板/布局缩略图卡片选择器：分类 chips + 搜索框 + 缩略图网格；缩略图 ~240px 由 gen-samples 扩展生成（约 +5MB），SW 预缓存。
  - T4.2 批量导出：边框模式多选 → 队列渲染 → 逐张自动下载 + 进度显示。
  - T4.3 EXIF 面板可视化（表格化，缺失项灰显"无"）。
  - T4.4 参数微调三项：字号缩放 / 文字颜色 / 内边距缩放——引擎加 `TemplateOverrides`（core API + wasm 透传），UI 按 localStorage 按模板 id 记忆 + 一键重置。
- **T5 性能硬指标（本机 Lenovo 21J8 基准）**：60MP 相机 JPG 预览 ≤1.5s、导出 ≤4s；24MP 预览 ≤600ms；桌面引擎就绪 ≤2s。用 `tools/perf-check`（或 CLI 计时脚本）实测并记录数字。
- **T6 全量门禁**：cargo test + clippy + 四 target 构建 + wasm smoke（帧字节一致/拼图像素门禁）+ 黄金基线/样张/缩略图重生成（注明原因）。
- **T7 发布 v0.1.2**：bump 版本 → push → CI 全绿 → API 打 tag → Release（CLI/桌面/模板包/update.json + **NSIS 安装包**，release.yml 需加 tauri 构建步骤）→ Pages 部署验证（样张墙/双语/双主题线上可用）。
- **T8 交付**：重启桌面版交用户验收；PRD Discoveries 补记全部决策与指标实测值。

## 验收总门（全部满足才算完）

1. 用户可从"打开软件"到"导出成品"全程无死路（任何错误有明确文案）。
2. T5 三项硬指标实测达标并留数字。
3. 明/暗主题 + zh/en 全站可用且记忆生效。
4. 本地与云端 CI 全绿；v0.1.2 Release 四件套 + NSIS 齐全；update.json 版本正确。
5. PRD 与本文件同步更新。
