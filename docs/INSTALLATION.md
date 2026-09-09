# INSTALLATION.md — FrameGeist 构建环境基线

> 对应 PRD 实施顺序第 1 步。本文件记录 2026-09-09 在基准机（Lenovo 21J8）上实测完成的安装与验证。

## 已完成的安装

| 工具 | 版本 | 来源 | 状态 |
|---|---|---|---|
| Rust (rustup) | rustc 1.98.1 stable-msvc | https://win.rustup.rs/x86_64 直接安装（winget 的 Rustlang.Rustup 包会崩溃，退出码 3221225477，勿用） | ✅ |
| MSVC 工具链 | Visual Studio 18 BuildTools（含 VC.Tools.x86.x64） | 机器预装于 `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` | ✅ |
| JDK | Temurin 17.0.20.1 | `winget install EclipseAdoptium.Temurin.17.JDK` | ✅ |
| rustup targets | wasm32-unknown-unknown / aarch64-linux-android / aarch64-unknown-linux-ohos | `rustup target add` | ✅ |

## 环境变量注意

JDK 未写入 PATH。后续 Android/鸿蒙构建需显式设置：

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
```

cargo 首次使用需把 `%USERPROFILE%\.cargo\bin` 加入 PATH（当前会话未自动刷新）：

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

## wasm32 构建的特殊配置

getrandom 0.3 在 wasm32-unknown-unknown 上要求显式后端，仓库根的 `.cargo/config.toml` 已配置：

```toml
[target.wasm32-unknown-unknown]
rustflags = ["--cfg", "getrandom_backend=\"wasm_js\""]
```

同时 `framegeist-core` 在 wasm32 目标下引入 `getrandom`（`wasm_js` feature）以完成 feature 统一。

## 验证命令（本 PRD 的 A1/N5 门禁）

```powershell
cargo test --workspace          # 单元测试 + 黄金图回归（基线见 crates/framegeist-cli/tests/golden/baselines.json）
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p framegeist-core --release --target x86_64-pc-windows-msvc
cargo build -p framegeist-core --release --target wasm32-unknown-unknown
cargo build -p framegeist-core --release --target aarch64-linux-android
cargo build -p framegeist-core --release --target aarch64-unknown-linux-ohos
```

## 黄金图基线再生成（仅当渲染语义合法变更时）

```powershell
$env:FRAMEGEIST_UPDATE_BASELINES = "1"
cargo test -p framegeist-cli --test golden
Remove-Item Env:\FRAMEGEIST_UPDATE_BASELINES
```

## 尚未安装（后续步骤的前置）

- Android SDK / NDK / cargo-ndk（实施顺序第 8 步前）
- DevEco Studio + OpenHarmony SDK（第 9 步前，验证 PRD Q7 需要最小样例）

## 已知坑（2026-09-09 实测）

1. **winget 装 rustup 崩溃**（退出码 3221225477）：用官方 rustup-init.exe。
2. **crates.io 的 `exif` 是占位 crate**（0.0.1，libexif 包装）：真身是 `kamadak-exif`，lib 名为 `exif`，用 `exif = { package = "kamadak-exif", version = "0.6.1" }` 重命名引用。
3. **jsonschema 0.17 无法编译到 wasm32**（reqwest blocking + url 依赖）：引擎改用内置校验器（serde `deny_unknown_fields` + 语义校验），schema 文件保留为规格文档 `docs/schema/template.schema.json`。
4. **kamadak-exif 的 `Writer`** 在 `exif::experimental` 模块下，且要求 IFD 连续非空——引擎把清理后的字段统一归入 PRIMARY IFD，由 Writer 自动合成 ExifIFDPointer。
5. **`In::EXIF`/`In::Exif` 不存在**：Exif 子 IFD 用 `exif::In(2)`；ISO 字段名为 `Tag::PhotographicSensitivity`（0x8827）。
