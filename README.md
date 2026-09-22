# FrameGeist（框灵）

免费开源的本地照片边框/水印/拼图工具：一个 Rust 引擎（`framegeist-core`）驱动 CLI / Web / Windows 桌面端，
同一模板四端像素级一致，**照片与元数据不出本机**（零上传、零账号）。

## 功能亮点（v0.9.0）

- **192 套原创模板 / 25 分类**，按 DESIGN-LANGUAGE v2 排版：瑞士 / 编辑杂志 / 日系 / 潮牌 / 器材说明书五种风格体系。
- **彩色品牌徽标**（v0.9.0）：Simple Icons 官方 hex 经阈值规则判定（15 彩色 / 4 单色），主变体直接上官方色；
  局部背景对比不足 3:1（WCAG 1.4.11）自动回退黑白变体，仍不足加描边/底板；`tint:"color"` 可强制官方彩色，
  暗色主题缩略图与模板墙标记同步彩色。
- **徽标尺寸再提升**（v0.9.0）：引擎默认层高 4.5%→**6.5%**、下限 5%→**6%**、最大宽 38%→**44%**（仍 ≥18px）；
  192 套模板徽标层批量 ×1.3（上界 0.12，越界/重叠自动回退并记录）。
- **五 Tab 侧边栏 + 紧凑导出条**（v0.9.0）：模板 / 照片 / 元素 / 画布 / 导出五个分区，单一滚动区零遮挡，
  底部导出条（≤56px）常驻渲染/导出与尺寸格式摘要，Tab 选择本地记忆。
- **画布直接操作**（v0.9.0）：点选（重叠再点穿透）/ Shift 多选 / 拖移吸附参考线 / 四角等比缩放（文字改字号、图片徽标改尺寸）/
  文本与形状旋转（15° 吸附）/ Delete 删除 / 选区浮动工具条（删除/复制/置顶/置底/锁定）；
  手柄 10px 圆点 + ≥24px 隐形命中区（粗指针 14/32），空格/中键平移、缩放下拉与画布尺寸指示。
- **徽标库并入「添加元素」**（v0.9.0）：点「徽标」展开库（分组单选过滤 + 组内搜索 + 收藏/最近快捷行 + EXIF 自动识别 +
  自定义上传）；选中徽标层可开启「本图层单独覆盖」位置/大小/对比/不透明度（图层字段 > 模板级 > 模板 JSON）。
- **徽标库**（v0.8.0）：四组徽标（相机品牌 28 / 镜头品牌 38 / 系列徽章 13 / 游戏字标 6）96px 缩略图网格，
  可搜索、收藏、最近使用；**按图层替换**，「自动识别（EXIF）」一键恢复表达式层。
- **中文界面**（v0.8.0）：应用控件全量中文化（zh/en 键 100% 对齐，E2E 可见文本零英文残留）；
  模板艺术文字、引擎日期与 EXIF 单位保持原样。
- **品牌徽标系统 v2**：官方字标（Simple Icons CC0）与原创排版 lockup 一键切换；花底对比保护（黑白自适应/描边/底板）、
  四角定位、透明度 0.7–1.0。
- **排版现代化**：12 组新 OFL 字体（v0.8 新增 Instrument Serif）、静态多字重 400/500/600/700、
  EXIF 数值行 Inter tabular（`tnum`）、中英分类选字；字形覆盖门禁保证无豆腐块。
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

- 执行契约：`AGENTS.md`、`docs/V0.9.0-CONSTRAINTS.md`
- 设计语言：`docs/DESIGN-LANGUAGE.md`（排版系统 v2 + 徽标彩色规范）
- 模板规范：`docs/TEMPLATE-SPEC.md` · schema：`docs/schema/template.schema.json`
- 许可与来源：`docs/CREDITS.md`、`docs/licenses/`
- 进度报告：`docs/reports/v0.9.0/PROGRESS.md`（含每分类前后对比图 `docs/reports/v0.9.0/compare/`）

## 许可

代码 MIT。字体为 OFL-1.1（见 `docs/licenses/fonts/`），品牌字标为 CC0（Simple Icons）或本项目原创排版，
商标归各权利人所有，仅作器材信息识别展示。
