# FrameGeist v0.8.0 交接文档（新会话继续用）

> 生成时间：2026-09-20。执行契约：`docs/V0.8.0-CONSTRAINTS.md`（18 项决策，勿擅自更改）。
> 仓库：`D:\FrameGeist`（所有命令在此目录执行；旧路径 `D:\DSH` 已弃用）。
> **一句话状态**：M0–M3 已完成并自检通过；M4 完成约一半（fmt/test/clippy/wasm/i18n/对比度/UTF-8 已绿）。
> ⚠️ 最后一次 `gen-samples` 被中断：`templates/samples` 只有 127/192 张、previews/thumbs 仍是 v0.7 旧图（**必须先完整重跑**）。
> 视觉基线/E2E/性能/对比图/四 target 未跑；M5（文档 + v0.8.0 发布）未开始。

---

## 1. 环境配置

### 1.1 工具链（均可用）
| 工具 | 版本/说明 |
|---|---|
| Rust | 1.98.1（stable；targets：`x86_64-pc-windows-msvc`、`wasm32-unknown-unknown`、`aarch64-linux-android`、`aarch64-unknown-linux-ohos` 均已安装） |
| Node | v24.20.0；仓库只有 devDependency `@resvg/resvg-js`（资产生成用） |
| Python | 3.12 + `fontTools 4.54` + `py7zr` + `brotli`（字体管线） |
| wasm-bindgen | 0.2.128（必须与 crate 版本一致） |
| gh | 2.97.0，已登录 `meihuaanying`（token scopes：`gist read:org repo`，**无 `workflow`**） |
| Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（Edg/153） |

### 1.2 本地服务（按需重启）
```powershell
# 静态服务 8350
Start-Process node -ArgumentList 'tools/serve.mjs','8350' -WorkingDirectory 'D:\FrameGeist'
# E2E 用 headless Edge（CDP 9237）
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList `
  '--headless=new','--disable-gpu','--remote-debugging-port=9237',`
  '--user-data-dir=C:\Users\Lenovo\AppData\Local\Temp\fg-edge','--window-size=1440,900',`
  'http://localhost:8350/web/'
# 页面热重载（改了 web/ 后 E2E 前必做；否则测的是旧 JS）
node --input-type=module -e "const l=await (await fetch('http://127.0.0.1:9237/json/list')).json();const p=l.find(t=>t.type==='page'&&t.url.includes('localhost:8350'));const ws=new WebSocket(p.webSocketDebuggerUrl);ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Page.reload',params:{ignoreCache:true}}));ws.onmessage=e=>{if(JSON.parse(e.data).id===1){console.log('reloaded');process.exit(0)}}"
# 桌面端（带 CDP 9333，便于探针）
cargo build --release -p framegeist-desktop
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"; Start-Process "D:\FrameGeist\target\release\framegeist-desktop.exe"
```

### 1.3 网络/代理实况（重要）
- `github.com:443` **被阻断**（直连超时；`--resolve` 到备用 IP 也被重置）；`raw.githubusercontent.com`、`api.github.com`、`objects.githubusercontent.com` **可达**。
- git 全局代理指向 **已失效** 的 `http://127.0.0.1:7890`（`http.https://github.com/.proxy` 三个键）；需要直连时用 `-c "http.https://github.com/.proxy="` 覆盖。
- 本机曾发现可用的 HTTP 代理（**只放行 api.github.com，不放行 github.com**）：`127.0.0.1:9209`、`127.0.0.1:12063`（端口随时会变，扫描命令见 §7.3）。
- **推送/发布一律走 Git Data API**（见 §8 脚本），不要指望 `git push`。

### 1.4 Shell 陷阱（血泪）
- 工具 shell 时而 PowerShell、时而 bash：**避免 `&&`、`| head/tail`、`$(...)`**；统一「命令写日志文件 → 用 Read 工具看」。
- `node -e "..."` 里的 `$`、反引号、引号极易被 PowerShell 吞掉：**复杂脚本写成临时 .mjs 文件再运行**。
- 禁止用 PowerShell `Set-Content/Out-File` 改写仓库文本（v0.6.1 事故）；统一 Write/Edit 工具或 Node 脚本。
- 发布前必跑 `node tools/check-utf8.mjs`。

---

## 2. v0.8.0 契约与决策摘要（详见 `docs/V0.8.0-CONSTRAINTS.md`）

- UI 仅应用控件中文化（品牌/机型/技术缩写白名单）；模板艺术文字、引擎日期、EXIF 单位不改。
- i18n 门禁：zh/en 键对齐 + 硬编码扫描 + E2E 中文界面零英文残留。
- 徽标库：右侧栏独立卡片（替换旧品牌卡）；四组（相机/镜头/系列/游戏）；96px 预生成缩略图；**图层级替换**；
  「自动识别（EXIF）」恢复表达式；收藏/最近；官方/原创风格联动；墙入口弹层；墙卡片品牌标记。
- 字体：Data/Label ×1.2、Support ×1.1、Display 不变；越界/重叠自动回退。
- 徽标：下限 5%、默认 4.5%、最大宽 38%；模板徽标层抬到 ≥0.045。
- 允许全量重渲 + 基线重生成 + 每分类对比图。
- v0.8.0 一口气发布（六资产 + Pages），**Git Data API 推送，禁改 `.github/workflows/*`**。

---

## 3. 已完成工作（M0–M3）

### M0 — UI 中文化 + i18n 门禁 ✅
- 新增 `tools/check-i18n.mjs`：键对齐、占位符一致、未翻译键、未知键、硬编码文案扫描（JS/HTML，含白名单）。
  **当前 380 zh / 380 en，0 failure**。
- `web/i18n.js`：新增徽标库/图层类型/预设名等 ~40 键；`applyI18n` 支持 `data-i18n-aria-label`。
- `web/editor.js`：图层类型标签 `layer.type.*` 中文化；显示/隐藏/锁定 title 走 `t()`。
- `web/index.html`：7 个预设选项、主题按钮 title、aria-label 全部本地化。
- 修复上一轮卡死问题的修复也在此分支内（字体请求超时、按文件字重追踪 `loadedFiles`、灯箱 `.brand-strip lightbox` 类名冲突改为 `lb-brand`）。

### M1 — 徽标库 ✅
- `tools/gen-brand-assets.mjs` 重写：512px + **96px thumbs**（`*/thumbs/`）；新增中性 `brand/exif-auto`（原创 EXIF 标）；
  `web/brand/index.json` **v2 分组清单**：`{version:2, groups:{camera:28,lens:38,series:13,game:6}, neutral:"exif-auto"}`。
- `web/index.html`：新「徽标库」卡片（`#brandGroups`/`#brandQuick`/`#brandLibGrid`/`#brandSearch`/`#brandAuto`/`#uploadLogo`/`#clearLogo`），
  保留风格/位置/大小/对比/透明度控件；墙头 `#wallBrandLib` + 弹层 `#brandLibModal`。
- `web/app.js`：`brandLibData/brandLibState`、`loadBrandLibrary/renderBrandLibrary/renderModalLibrary/renderLibGrid/applyBrandChoice`、
  `badgeTarget/badgeGroupsFor/libThumb`；收藏/最近（`fg-brand-fav-v1`/`fg-brand-recent-v1`）；移除全局 `brandOverride` 逻辑。
- `web/editor.js`：`badgeTarget()`（选中层优先，否则第一个徽标层）、`setBadgeAsset()`（含 `"auto"` 从原始模板恢复）、
  `swapBadgeStyle()`（实体资产 brand↔lockup 互换），并挂到 `window.__fgEditor`。
- `tools/gen-templates.mjs`：清单每项新增 `marks`（≤3 个品牌标记；表达式模板回退 `exif-auto`）；**175/192 套有标记**。
- `web/styles.css`：库网格/筹码/弹层/墙标记样式；`.wall-card`、`.thumb`、`.brand-lib-cell` 加 `content-visibility: auto`。
- 实测（headless Edge）：分组过滤/96px 缩略图/点击替换/自动恢复/收藏/搜索/风格互换/墙弹层/卡片标记 **全部通过，无异常**。

### M2 — 默认尺寸提升 ✅
- 引擎（`crates/framegeist-core/src/render.rs`）：徽标下限 `0.035→0.05`（仍 ≥18px）、默认层高 `0.03→0.045`、
  最大宽 `0.32→0.38`；`tests/engine_v070.rs` 更新 + 新增「4.5% 默认高」用例（**5/5 绿**）。
- 新增 CLI 子命令 `framegeist boxes <photo> --template <file>`：输出 `{canvas:{w,h}, boxes:[...]}`（新增
  `framegeist_core::boxes::canvas_size_for_photo`）。
- 新增 `tools/apply-v080-typography.mjs`：角色放大（Data/Label ×1.2、Support ×1.1、Display 不变、下限 0.0095）、
  徽标层抬到 ≥0.045；**基线对比 + 跳过旋转层**的越界/重叠守卫（候选写到 `target/v080-candidate.json`）。
  结果：**192 套处理、178 个徽标层抬高、6 套 12 层因新冲突回退、0 未解决**；
  报告 `docs/reports/v0.8.0/typography-report.json`；模板 `meta.version` 已升 `1.2.0`（幂等标记，`minEngineVersion` 保持 0.7.0）。
- `tools/fetch-fonts.mjs`：补上遗漏的 **Instrument Serif**（OFL，静态 400）；字体管线现 **69 faces / 23 families**
  （`templates/assets/fonts/fonts.json` 与 web 镜像已重建，`InstrumentSerif-400.ttf` 就位）。
- 生成器/清单重跑：`gen-brand-assets`、`gen-templates`；`check-glyph-coverage` 355 对 0 缺失；`validate-templates --all` **192/192**。

### M3 — 性能与首启 ✅（代码完成）
- 墙卡片/选择器缩略图/库格子 `content-visibility: auto` + `contain-intrinsic-size`。
- 启动墙骨架：`showWallSkeleton()`（`window.__wallSkeleton = {shown, at, clearedAt}`），`buildWall()` 清除。
- 首启提示沿用：8s 状态提示、25s toast（i18n 键 `status.bootSlow`/`err.bootHint`）。

### M4 — 已完成部分 ✅
| 检查 | 结果 |
|---|---|
| `cargo fmt --all -- --check` | ✅ |
| `cargo test --release --workspace` | ✅ 全绿（金标未受影响） |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ |
| `node tools/wasm-build.mjs`（SIMD + wasm-opt + smoke） | ✅ 模块 **5,058,426 B**；WASM↔CLI 帧字节一致；拼图 0.000013 |
| `node tools/check-i18n.mjs` | ✅ 380/380，0 |
| `node tools/check-ui-contrast.mjs` | ✅ APCA 全过 |
| `node tools/check-utf8.mjs` | ✅ 904 文件 0 损坏 |
| `node tools/check-glyph-coverage.mjs` | ✅ 355 对 0 缺失 |
| `node tools/validate-templates.mjs --all` | ✅ 192 ok / 0 failed |

---

## 4. 未完成待办（按顺序执行）

### 4.1 M4 剩余
1. **样片重渲（必须先做；上次被中断，产物不完整）**：
   ```powershell
   node tools/gen-samples.mjs --concurrency 6   # 576 张，约 10–20 分钟
   # 完成标志：日志末尾 "rendered=192 failed=0; thumbs+previews mirrored to web/"
   # 完成后 templates/samples|previews|thumbs 与 web/previews|thumbs 均为 192 张
   ```
2. **视觉基线重生成**（原因必须记录到 PROGRESS：字号/徽标默认变化）：
   ```powershell
   node tools/visual-regression.mjs --update      # 384 项
   node tools/visual-regression.mjs               # 复核模式应全绿
   ```
   金标如失败再 `$env:FRAMEGEIST_UPDATE_BASELINES="1"; cargo test --release -p framegeist-cli --test golden`（本会话测试已绿，预计不需要）。
3. **每分类对比图**（v0.7 → v0.8）：
   ```powershell
   node tools/make-compare-sheets.mjs --before .cache/v070-samples --out docs/reports/v0.8.0/compare
   ```
   ⚠️ 本次重渲**没来得及快照 v0.7 样片**（`templates/samples` 是 gitignore 的派生物）。恢复办法（任选）：
   1. **从已发布的 Pages 下载**（推荐，就是 v0.7.0 线上样片）：
      ```powershell
      New-Item -ItemType Directory -Force .cache/v070-samples | Out-Null
      node -e "const fs=require('fs');(async()=>{const m=require('./web/templates.json');for(const t of m){const r=await fetch('https://meihuaanying.github.io/framegeist/samples/'+t.id+'.jpg');if(r.ok)fs.writeFileSync('.cache/v070-samples/'+t.id+'.jpg',Buffer.from(await r.arrayBuffer()));}})()"
      ```
   2. 退而求其次：`.cache/v061-samples/` 有 v0.6.1 快照（对比标注写 v0.6.1 即可）。
   3. 直接复用 `docs/reports/v0.7.0/compare/` 里的旧图做局部对比，并在报告中注明来源。
4. **E2E（新增 15 条，预期 235/235）**：
   ```powershell
   # 启动 serve + headless Edge（§1.2）→ 热重载页面 → 跑
   $env:FG_CDP_PORT="9237"; node tools/e2e-audit.mjs docs/reports/v0.8.0
   ```
   新增断言在 `tools/e2e-audit.mjs` 末尾 **section 79**（徽标库 15 条 + 中文残留扫描 + content-visibility + 骨架）。
   首次运行可能需要在页面探针层面微调（用 temp 里的 `lib-probe.mjs` 模式排查）。
5. **性能**：`FG_CDP_PORT=9237 node tools/perf-audit.mjs`（要求 4/4；24MP 预览 ≤600ms/导出 ≤2s，60MP ≤1.5s/≤4s）。
6. **四 target**：`cargo build -p framegeist-wasm --target wasm32-unknown-unknown --release`、
   `cargo build -p framegeist-core --release --target aarch64-linux-android`、同 ohos、`cargo build --release -p framegeist-cli`。
7. 桌面端重建并启动交付（§1.2 命令；构建约 3–5 分钟）。

### 4.2 M5 — 文档与发布 v0.8.0
1. 版本统一：`Cargo.toml`（workspace 0.7.0→**0.8.0**）、`crates/framegeist-desktop/tauri.conf.json`、
   `web/app.js APP_VERSION`、`web/sw.js VERSION`。
2. 文档：`README.md`（补徽标库/中文化）、`docs/CREDITS.md`（thumbs/exif-auto/Instrument Serif）、
   `docs/TEMPLATE-SPEC.md`（新尺寸默认）、`docs/DESIGN-LANGUAGE.md`（5%/4.5%/38%）、
   `docs/prds/framegeist.md` Discoveries、`AGENTS.md` 状态、`docs/reports/v0.8.0/PROGRESS.md`（M0–M5）、
   `docs/releases/v0.8.0.md`（含商标声明）。
3. commit（本地，`git commit -F 消息文件`）→ **Git Data API 推送**（§8）→ annotated tag `v0.8.0`（API 创建）→
   Release 六资产（CI `release.yml` 自动；说明用 `gh release edit --notes-file docs/releases/v0.8.0.md`）→
   Pages 200 验证（`https://meihuaanying.github.io/framegeist/` 与 `/web/`）。
4. 远端基线：**remote main = `ac24ffacce833bd732b7ae1ddf2868d263d1e2ee`**（v0.7.0 收尾 docs commit）；
   本地 main = `664cc20`（内容等价的本地 docs commit）→ 用 API 推送时 base 取远端 `ac24ffa`。

---

## 5. 本次会话关键文件改动（未提交）

| 类型 | 文件 |
|---|---|
| 新增 | `tools/check-i18n.mjs`、`tools/apply-v080-typography.mjs`、`docs/V0.8.0-CONSTRAINTS.md`、`docs/reports/v0.8.0/{HANDOFF.md,typography-report.json}`、`web/brand/thumbs/*`、`web/lockup/thumbs/*`、`web/series/thumbs/*`、`web/game/thumbs/*`、`templates/assets/brand/exif-auto*.png`、`…/series/leica-apo*.png`、`…/brand/voigtlander*.png`、`templates/assets/fonts/InstrumentSerif-400.ttf` |
| 引擎 | `crates/framegeist-core/src/render.rs`（尺寸默认）、`src/boxes.rs`（`canvas_size_for_photo`）、`tests/engine_v070.rs`、`crates/framegeist-cli/src/main.rs`（`boxes` 子命令） |
| Web | `web/app.js`、`web/editor.js`、`web/i18n.js`、`web/index.html`、`web/styles.css` |
| 工具 | `tools/gen-brand-assets.mjs`、`tools/gen-templates.mjs`、`tools/fetch-fonts.mjs`、`tools/font-pins.json`、`tools/e2e-audit.mjs` |
| 模板 | 192 套 JSON（`version 1.2.0`、字号/徽标尺寸变化）；`web/templates.json`、`web/templates/*` 镜像 |
| 字体 | `templates/assets/fonts/fonts.json` 与 web 镜像重建（69 faces / 23 families，**已修**） |
| 其它 | `docs/reports/v0.7.0/*.png`（E2E 截图被重跑覆盖，属正常） |

---

## 6. 已知问题 / 风险 / 注意事项

1. **`apply-v080-typography.mjs --force` 会叠加放大**：模板已是 1.2.0 时再跑会把尺寸又乘一遍。
   重放前先 `git checkout -- templates`（回到 v0.7 提交态）再跑，或只做局部 `--only`。
2. `git checkout -- templates` 曾把 `fonts.json` 等**已跟踪**派生文件回退（本次已用
   `C:\Users\Lenovo\AppData\Local\Temp\opencode\fix-font-manifest.mjs` 修复）。新会话如见字体数量不对，用同法重建。
3. `boxes` 的盒计算**不含 v0.7 新增的四角定位**（`corner`）与旋转的精确盒；排版守卫已跳过旋转层，属已知近似。
4. E2E 新 section 79 **尚未实跑**；中文残留白名单可能需按实际报错微调（只允许加专有名词/缩写）。
5. 若 headless Edge 出现多个页面目标或视口变小（曾见 360×505），**杀掉 9237 实例重启**再跑 E2E。
6. 临时辅助脚本在 `C:\Users\Lenovo\AppData\Local\Temp\opencode\`（可能被系统清理）：`gh-api-push.mjs`（§8 全文内嵌）、
   `desktop-diag.mjs`、`lib-probe.mjs`、`fix-font-manifest.mjs`、`gh-proxy.mjs`。丢失可从本文档重建。
7. Git 数据分流：本地 main 与远端 main **内容等价但 commit 不同**（v0.7 发布时 API 推送所致）；新会话推送前
   先确定 base = 远端 `ac24ffa`，避免非快进。
8. GitHub token **无 `workflow` scope**：任何提交只要包含 `.github/workflows/*` 的改动，ref 更新会 404。**禁止改 workflow 文件**。

---

## 7. 常用速查

### 7.1 门禁一条龙（M4 全量）
```powershell
cargo fmt --all -- --check
cargo test --release --workspace
cargo clippy --workspace --all-targets -- -D warnings
node tools/wasm-build.mjs
node tools/check-i18n.mjs
node tools/check-ui-contrast.mjs
node tools/check-glyph-coverage.mjs
node tools/check-utf8.mjs
node tools/validate-templates.mjs --all
node tools/gen-samples.mjs --concurrency 6
node tools/visual-regression.mjs --update
$env:FG_CDP_PORT="9237"; node tools/e2e-audit.mjs docs/reports/v0.8.0
FG_CDP_PORT=9237 node tools/perf-audit.mjs
```

### 7.2 版本/端口约定
- 版本号四处：`Cargo.toml`(workspace) / `crates/framegeist-desktop/tauri.conf.json` / `web/app.js APP_VERSION` / `web/sw.js VERSION`。
- 端口：预览 8350；E2E CDP 9237；桌面 CDP 9333；Windows 排除端口段 8101–8200 勿用。

### 7.3 代理发现（端口会变）
```powershell
Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 | Select-Object -ExpandProperty LocalPort -Unique | ForEach-Object {
  $c = curl.exe -s -o NUL -w "%{http_code}" --max-time 3 -x "http://127.0.0.1:$_" https://api.github.com/
  if ($c -eq "200") { "proxy $_" }
}
```

---

## 8. Git Data API 推送脚本（自包含；建议保存为 `tools/gh-api-push.mjs`）

用途：`github.com` 不可达时，用 `api.github.com` 把本地 commit 的树推到远端分支。
**不修改 workflow 文件时才能成功**。用法：`node tools/gh-api-push.mjs <target-rev> <base-rev> <branch> <message-file>`，
成功后删除工作区里的 `gh-api-entries.json` 缓存（脚本会写在该路径）。

```js
// tools/gh-api-push.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [target, base, branch, msgFile] = process.argv.slice(2);
const REPO = "meihuaanying/framegeist";
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const api = async (method, path, body) => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "FrameGeist-release", "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      if (attempt === 5) throw new Error(`${method} ${path}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
};

const CACHE = "gh-api-entries.json";
let entries;
try { entries = JSON.parse(readFileSync(CACHE, "utf8")); console.log(`resumed ${entries.length}`); } catch { /* fresh */ }
if (!entries) {
  const diff = execFileSync("git", ["diff", "--name-status", "--no-renames", base, target], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map((line) => { const [status, file] = line.split("\t"); return { status, file }; });
  console.log(`diff ${base}..${target}: ${diff.length} entries`);
  entries = [];
  let done = 0;
  const handle = async ({ status, file }) => {
    if (status === "D") { entries.push({ path: file, mode: "100644", type: "blob", sha: null }); }
    else {
      const buf = readFileSync(file);
      const blob = await api("POST", `/repos/${REPO}/git/blobs`, { content: buf.toString("base64"), encoding: "base64" });
      entries.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
    }
    done += 1;
    if (done % 100 === 0) console.log(`  blobs ${done}/${diff.length}`);
  };
  const queue = [...diff];
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await handle(queue.shift()); }));
  writeFileSync(CACHE, JSON.stringify(entries));
}

const baseCommit = await api("GET", `/repos/${REPO}/commits/${base}`);
const message = readFileSync(msgFile, "utf8");
// 大树必须按顶层目录分块构建（单次 4000+ 条目会 404/504）
const byDir = new Map();
const root = [];
for (const e of entries) {
  const i = e.path.indexOf("/");
  if (i < 0) root.push(e);
  else { const dir = e.path.slice(0, i); if (!byDir.has(dir)) byDir.set(dir, []); byDir.get(dir).push(e); }
}
const baseTree = await api("GET", `/repos/${REPO}/git/trees/${baseCommit.commit.tree.sha}`);
const buildTree = async (baseSha, list, label) => {
  let current = baseSha;
  for (let i = 0; i < list.length; i += 120) {
    const chunk = list.slice(i, i + 120);
    const t = await api("POST", `/repos/${REPO}/git/trees`, { base_tree: current, tree: chunk });
    current = t.sha;
    if (list.length > 120) console.log(`  ${label} ${Math.min(i + 120, list.length)}/${list.length}`);
  }
  return current;
};
const subEntries = [];
for (const [dir, list] of byDir) {
  const baseSub = baseTree.tree.find((t) => t.path === dir && t.type === "tree")?.sha;
  const stripped = list.map((t) => ({ ...t, path: t.path.slice(dir.length + 1) }));
  const sub = await buildTree(baseSub, stripped, dir);
  subEntries.push({ path: dir, mode: "040000", type: "tree", sha: sub });
}
const rootBase = await buildTree(baseCommit.commit.tree.sha, root, "(root)");
const tree = await api("POST", `/repos/${REPO}/git/trees`, { base_tree: rootBase, tree: subEntries });
const commit = await api("POST", `/repos/${REPO}/git/commits`, { message, tree: tree.sha, parents: [baseCommit.sha] });
await api("PATCH", `/repos/${REPO}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
console.log(`main -> ${commit.sha}`);

/* 打 tag（annotated）：
   TAG=$(gh api -X POST repos/meihuaanying/framegeist/git/tags -f tag=v0.8.0 \
     -f message="FrameGeist v0.8.0" -f object=<commit.sha> -f type=commit --jq .sha)
   gh api -X POST repos/meihuaanying/framegeist/git/refs -f ref=refs/tags/v0.8.0 -f sha=$TAG */
```

---

## 9. 新会话起手指令（建议直接贴给新对话）

> 仓库 `D:\FrameGeist`。先读 `AGENTS.md`、`docs/V0.8.0-CONSTRAINTS.md`、`docs/reports/v0.8.0/HANDOFF.md`，
> 然后按 HANDOFF §4 继续：① 确认样片重渲完成 ② 视觉基线 `--update` ③ 生成/整理每分类对比图
> ④ 跑 E2E（预期 235/235，新断言在 section 79，失败就按探针法修）⑤ 性能与四 target ⑥ 桌面端重建
> ⑦ 文档 + 版本 0.8.0 + Git Data API 推送 + tag + Release 六资产 + Pages 验证。
> 铁律：不改 `.github/workflows/*`；不用 PowerShell 改写含非 ASCII 文件；发布前 `check-utf8`。
