# FrameGeist（框灵）

免费开源的本地照片边框/水印/拼图工具：一个 Rust 引擎（`framegeist-core`）驱动 CLI / Web / Windows 桌面端，
同一模板四端像素级一致，**照片与元数据不出本机**（零上传、零账号）。

## 功能亮点（v0.7.0）

- **192 套原创模板 / 25 分类**，按 DESIGN-LANGUAGE v2 排版：瑞士 / 编辑杂志 / 日系 / 潮牌 / 器材说明书五种风格体系。
- **品牌徽标系统 v2**：官方字标（Simple Icons CC0）与原创排版 lockup 一键切换；42 品牌 + 12 镜头系列徽章；
  尺寸下限（≥3.5% 照片高且 ≥18px）、花底对比保护（黑白自适应/描边/底板）、四角定位、透明度 0.7–1.0。
- **排版现代化**：11 组新 OFL 字体、静态多字重 400/500/600/700、EXIF 数值行 Inter tabular（`tnum`）、
  中英分类选字；字形覆盖门禁保证无豆腐块。
- **EXIF 直通**：读取真实拍摄参数并原样保留/剥离（GPS、序列号默认移除，可显式保留）。
- **导出**：JPEG / PNG / AVIF / WebP，ICC 与 EXIF 直通，长边预设（原图 / 6K / 4K / 2K）。
- **拼图**：模板拼图 + 自由拼图、批量导出；本地字体/Logo 上传；深浅主题与中英双语。

## 构建与运行

```bash
cargo build --release -p framegeist-cli          # CLI
node tools/serve.mjs 8350                        # Web 本地预览（http://localhost:8350/web/）
cargo tauri build --bundles nsis                 # Windows 桌面安装包（在 crates/framegeist-desktop）
```

工具链：Rust stable、Node 20+、Python 3 + fontTools（字体管线）。详细安装见 `docs/INSTALLATION.md`。

## 文档

- 执行契约：`AGENTS.md`、`docs/V0.7.0-CONSTRAINTS.md`
- 设计语言：`docs/DESIGN-LANGUAGE.md`（v0.7.0 排版系统）
- 模板规范：`docs/TEMPLATE-SPEC.md` · schema：`docs/schema/template.schema.json`
- 许可与来源：`docs/CREDITS.md`、`docs/licenses/`
- 进度报告：`docs/reports/v0.7.0/PROGRESS.md`（含每分类前后对比图 `docs/reports/v0.7.0/compare/`）

## 许可

代码 MIT。字体为 OFL-1.1（见 `docs/licenses/fonts/`），品牌字标为 CC0（Simple Icons）或本项目原创排版，
商标归各权利人所有，仅作器材信息识别展示。
