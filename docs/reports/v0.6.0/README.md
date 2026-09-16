# FrameGeist v0.6.0 — 发布报告

> 契约：`docs/V0.6.0-CONSTRAINTS.md`（用户逐项 grill 确认后执行）。进度：`PROGRESS.md`（M0–M4）。

## 主题

**所见即所得的 EXIF 真实化** + **十项前沿增强**：

1. 三张用户原片（SONY ILCE-7RM3 / NIKON Z 6_2 / Canon EOS R7）的真实 EXIF 按方向注入 192 张样片 —— 水印模板在应用墙、灯箱、官网、编辑器示例、文档截图里全部显示真实机型/镜头/参数/日期；
2. 引擎：EXIF 字节级直通导出（MakerNote/Fuji 配方全保留，GPS/序列号仍剥离、Orientation 归一）、ICC（Display P3/Adobe RGB→sRGB）、`date('LOCAL')` 本地化、`tnum` 表格数字、写法打磨、EXIF 预览覆盖（无 EXIF 照片可一键「填入示例」）；
3. Web：示例照片 chips、无 EXIF 提示、EXIF 字段点选插入、导出前元数据透明提示、HEIC 浏览器解码（libheif-js，LGPL，惰性加载）、AVIF/WebP 导出、引擎字体离线预热；
4. 工程：wasm SIMD + wasm-opt（模块 5.95MB ≤15MB）、dHash 视觉回归门禁（384 图）、EXIF 门禁升级、E2E 195 条。

## 门禁证据（2026-09-16 终测）

| 门禁 | 结果 |
|---|---|
| E2E（headless Edge/CDP，无页面错误） | **195/195** |
| `cargo test --release --workspace` | 全绿（含 exif_passthrough 7 项、engine_v060 8 项、color 3 项、photo_meta 4 项、fuzz 1 万次） |
| `cargo clippy --workspace --all-targets -- -D warnings` / `cargo fmt --check` | exit 0 / CLEAN |
| WASM↔CLI 字节一致；拼图差 | ✅ / 0.000013（≤0.001） |
| 四 target（msvc/wasm32/aarch64-android/aarch64-ohos） | 全 ✅ |
| 性能（24MP/60MP 预览+导出） | 4/4 PASS |
| `check-photo-uniqueness`（含 EXIF 真实性） | 全绿 |
| `visual-regression`（384 图 dHash+均色） | 全绿（≤10 bit / Δ≤2.5） |
| wasm 体积 | 5.95MB（预算 15MB） |
| 金标 | 按 Q13 重生成（原因：EXIF 直通改变导出 APP1 字节） |

## 已知取舍（如实记录）

- **HEIC EXIF**：libheif-js 只解码像素不产出元数据，HEIC 照片的 EXIF 行可能为空（`probe_exif` 对 HEIC 容错为 null），文档与 UX 提示已注明。
- **AVIF 解码工具**：`image` 未启用 `avif-native`（避免 C 依赖），CLI `pixel-hash/visual-hash` 不能读 `.avif`；浏览器原生解码不受影响。
- **字体离线**：首次访问即离线时无法获得引擎字体（按需加载后写入 CacheStorage 并空闲预取 9 款）。
- **Tauri**：最新稳定 2.11.5 = 当前锁定；3.x 尚为 alpha，未升级。
- **署名**：三张示例照片由用户提供（Q6 可署名可入库），CREDITS 暂记「用户提供的示例摄影」；如需指定署名请告知。

## 资源与许可

- 示例照片 3 张：`web/examples/`（压缩至 ≤2560/q92，EXIF+ICC 保留）；原片不入仓（`incoming/` gitignored）。
- `web/vendor/libheif/libheif-bundle.mjs`：libheif-js 1.23.2（LGPL-3.0，全文见 `docs/licenses/libheif-js-LGPL-3.0.txt`）。
- Rust 新增依赖：`img-parts`（MIT）、`moxcms`（BSD-3-Clause/Apache-2.0）、`little_exif`（dev，MIT）；构建工具 binaryen（Apache-2.0，npx 按需）。

## 发布

- 版本：workspace / tauri.conf / web `APP_VERSION` = **0.6.0**；SW 缓存 `framegeist-0.6.0`。
- Tag `v0.6.0` → CI `release.yml`：CLI zip、桌面 zip、模板 `.fgpkg`、NSIS、SHA256SUMS.txt、update.json。
- Pages：模板墙/下载页随站点部署更新（含新样片与示例照片）。
