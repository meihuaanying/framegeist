# 事故报告：`@resvg/resvg-js` 原生内存不归还导致整机内存耗尽（2026-10-01）

## 1. 影响

- 2026-10-01 多次出现「您的系统内存不足」提示，随后出现蓝屏（`0x3B` / `0x116` / `0x7E`）。
- Windows 内存诊断（`MemoryDiagnostics-Results.dmp` 记录的条目）显示：
  `node.exe` 24.20.0 提交内存 **137,717,194,752 B ≈ 128 GB**，
  触发时间与我执行的 `node tools/gen-brand-assets.mjs --only arknights,wukong,wwmeet,leica-apo,canon-l` 高度吻合（命令发出后 0.44 s 创建的进程）。
- 影响面：品牌资产生成链路（`gen-brand-assets.mjs` / `import-brand-inbox.mjs` / `make-compare-sheets.mjs`）。**产品运行时（Web / Tauri）不受影响** —— 浏览器与桌面端都用 Canvas/SVG，不经过 resvg。

## 2. 根因

`@resvg/resvg-js` 的绑定层**没有释放接口**：

```
Object.getOwnPropertyNames(Resvg.prototype)   // → ["constructor"]
Object.getOwnPropertyNames(RenderedImage.prototype) // → ["asPng","height","pixels","width"]
```

- 每次 `new Resvg(svg, { font: { fontFiles: [...] } })` 都会**重新解析字体**（CJK 字体最贵）并在 Rust 侧分配一份 fontdb/usvg tree；
- 这些原生内存在 JS 堆上不可见，`global.gc()` 不会归还给 OS，只有**进程退出**才会全部释放。

### 实测（`target/probe-resvg-mem.mjs`）

单进程内连续 40 次 512×512 渲染，配合 `--expose-gc` + `global.gc()`：

| 指标 | 起始 | 结束 | 差值 |
|---|---|---|---|
| RSS | 94 MB | 140 MB | **≈ 1.2 MB / 次渲染（不归还）** |

单次渲染小、但资产工具会成百上千次渲染：57 品牌 × 3 变体 × 2 尺寸 + 24 序列/游戏 + 25 张对比图 ≈ 500+ 次 → 与 128 GB 提交内存的量级一致（叠加虚拟内存与提交内存计数的放大）。

## 3. 现场处置

- 确认无失控进程（node 合计 ≈ 0.9 GB，最大单进程 190 MB；空闲内存 12.1 GB / 64 GB）。
- 建议用户在系统层把**页面文件改为系统托管或 32 GB**（当时仅 5.888 GB），避免同类问题再次触发蓝屏。

## 4. 修复方案（已实施）

**按资产做子进程隔离**：父进程只负责枚举任务与汇总，每个资产在独立子进程里渲染，进程退出即归还全部原生内存。

```js
execFileSync(process.execPath, ["--max-old-space-size=1024", __filename, "--render-one", kind, slug], …)
```

三个工具统一加 `--render-one` 子模式：

| 工具 | 一次完整运行里的渲染次数（隔离前 / 后） |
|---|---|
| `tools/gen-brand-assets.mjs` | ~500+ → 每资产 1 进程（约 6 次渲染后即退出） |
| `tools/import-brand-inbox.mjs` | 22 品牌 × ~4 次 → 每品牌 1 进程 |
| `tools/make-compare-sheets.mjs` | 25 张合成图 → 每分类 1 进程 |

子进程契约：

- 父进程用 `stdio: ["ignore", "pipe", "inherit"]`，子进程在成功时打印一行机器可读标记
  `RENDER_OK <kind> <slug> <mode> <json>`；
- 父进程解析标记来重建原本在进程内累积的 `iconSlugs` / `iconCredits` / `wordCredits` / `lockupCredits` / 报告条目；
- manifest 与 `CREDITS.json` 的写入**仍然只发生在父进程**（`--render-one` 子模式跳过），保证「渲染被隔离、语义不变」；
- 子进程用 `--max-old-space-size=1024` 兜住任何 JS 侧意外增长。

**隔离必须字节等价**：隔离只改进程边界，不改任何渲染参数；改完后用 `png-dims.mjs` 与字节哈希核对重渲结果与隔离前一致，资产/样片/基线/对比图无需重生成。

## 5. 遗留风险与后续

- `resvg` 无 dispose API 是上游限制，除非上游提供显式释放，否则**任何批量渲染都必须走子进程**（包括未来新增的合成/导出工具）。
- 已知坑：`RenderedImage.pixels` 是惰性读取，在其生命周期外访问会**静默杀掉 node 进程**（exit 1、无报错）——必须先 `Uint8Array.from(image.pixels)` 拷出（见 `inkOffset()`）。
- 门禁纪律补充：**批量渲染类工具的运行必须用 `background: true` + 日志文件**，避免前台长命令被会话中断后留下半写状态（本工具均为幂等覆盖，重跑即可）。

## 6. 复现与验证脚本

- `target/probe-resvg-mem.mjs` —— 40 次渲染的 RSS 增长测量。
- `target/png-dims.mjs` —— 解码 PNG 输出画布/墨迹/留白，用于隔离前后逐字节对照。
