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

## 当前执行契约（v0.1.2 冲刺 — 2026-09-10 已完成 ✅）

> 结果存档：T1-T8 全部达成，v0.1.2 已发布（CLI/桌面/模板包/update.json + NSIS 安装包）。
> 实测性能（本机 WebView2）：引擎就绪 174ms；24MP 预览 300ms / 导出 1247ms；60MP 预览 799ms / 导出 3260ms。
> 新增回归：`visual_sanity`（文字可见/方向/预览/覆盖/原始路径）、`template_fuzz`（10 万次）、
> `templates_all_valid` 内存合成照片。桌面加载三根因修复记录见 PRD Discoveries 与 git log。

<details><summary>原始任务清单（T1-T8）</summary>

- **T1 修桌面/Web 加载死机**（状态卡 "loading wasm…"）
  - 根因三连：Tauri CSP 改写剥掉 `wasm-unsafe-eval`；旧 SW 缓存 tauri 源整页；模板下拉遗留 "loading…" 占位值。
  - 验收：引擎就绪 ≤2s ✅（174ms）；失败必显文案 ✅；导入即见原图 ✅。
- **T2 视觉重设计**（对标 deepseek.com/harness 视觉语言，保工具布局）✅
  - 三态主题（自动/浅/深，记忆 + 反 FOUC）；自托管 Host Grotesk + DM Sans；应用 + 官网 6 页。
- **T3 双语 zh/en**（K5 提前）✅
- **T4 功能**：缩略图选择器 ✅（63 模板 + 106 布局 SVG）；批量导出 ✅；EXIF 面板 ✅；三项微调 ✅（引擎 overrides）。
- **T5 性能硬指标** ✅（数字见上）。
- **T6 全量门禁** ✅（test/clippy/四 target/wasm 冒烟/基线与样张重生成）。
- **T7 发布 v0.1.2 + NSIS 进 Release** ✅。
- **T8 交付**：桌面重启验收 + PRD Discoveries 记录 ✅。

</details>

## 验收总门（全部满足才算完）

1. 用户可从"打开软件"到"导出成品"全程无死路（任何错误有明确文案）。
2. T5 三项硬指标实测达标并留数字。
3. 明/暗主题 + zh/en 全站可用且记忆生效。
4. 本地与云端 CI 全绿；v0.1.2 Release 四件套 + NSIS 齐全；update.json 版本正确。
5. PRD 与本文件同步更新。
