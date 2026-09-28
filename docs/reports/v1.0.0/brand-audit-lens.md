# FrameGeist v1.0.0 徽标官方核对对照表 · 镜头品牌补充篇（10 项）

> - **契约依据**：`docs/V1.0.0-CONSTRAINTS.md` §3.3（47 项对照表）+ `docs/reports/v1.0.0/brand-audit.md` §6 第 12 条裁决（**lens 组本轮一并核对 → 审计范围 47 → 57 项**）。
> - **配套文件**：`docs/reports/v1.0.0/brand-audit.md`（主表 47 项）、`docs/reports/v1.0.0/brand-delivery-checklist.md`（素材交付约定）。
> - **只读审计**：本报告未修改 `web/**`、`templates/**`、`crates/**`、`tools/**`、`docs/**`；仅新增本文件。为完成目视核对，审计过程中在**本机临时目录**（`%TEMP%\opencode\lens-audit\`）下载了官方 logo 文件用于比对，**未写入仓库、未随包分发**。
> - **状态**：**待用户审核**（审核通过前不落地任何徽标变更）。
> - **日期**：2026-09-28；审计基线：manifest v4（`web/brand/index.json`，2026-09-23 生成）+ `tools/brand-colors.json` v1 + `tools/gen-brand-assets.mjs`（v1.0.0）。

---

## 1. 范围、方法与证据

### 1.1 范围（10 项）与「不重复审计」口径

`web/brand/index.json` 的 `groups.lens` 共 **28 项**。其中：

| 子集 | 项数 | 处理 |
|---|---|---|
| 与 `groups.camera`（18 项）**同 slug 共享同一份资产** | 18 | **不重复审计**——资产路径 `web/brand/<slug>.png` 完全相同，主报告 §3.1 结论对其逐项有效（blackmagicdesign、canon、dji、epson、fujifilm、hasselblad、insta360、leica、nikon、olympus、panasonic、pentax、phaseone、ricoh、sigma、sony、tamron、zeiss） |
| **纯镜头品牌**（无相机 EXIF Make） | **10** | **本报告范围**：7artisans、laowa、meike、samyang、sirui、tokina、ttartisan、viltrox、voigtlander、yongnuo |

> 口径说明：本组 10 项在 `tools/brand-colors.json` 中**既无 `icons[slug]` 条目、也无 `originalColorOverride`**；在 manifest 中 `official: false`、`color: null`。其资产自 v0.9.0 起为**原创排印**（`tools/gen-brand-assets.mjs` 的 `LENS_ONLY` 常量，生成器第 47–50 行），因此主报告 §1.2「不在契约 47 项内、建议列入 v1.1 补充核对」的判断，本轮按 Q12 直接执行。

变体矩阵（本机实测存在，10/10 齐全）：`web/brand/<slug>.png` + `<slug>-mono.png` + `<slug>-light.png` + `web/brand/thumbs/` 96px 变体；镜像 `templates/assets/brand/`（含 `thumbs/`）与 `templates/assets/lockup/`（主 + `-mono` + `-light`）。

### 1.2 来源记号（沿用主报告，新增 1 个）

| 记号 | 含义 |
|---|---|
| `SI+` | 已实际抓取 Simple Icons CDN（`https://cdn.simpleicons.org/<slug>`）并核对 |
| `SI-` | 仅 Simple Icons 快照记录（`tools/brand-colors.json` / CREDITS.json），CDN 未逐项抓取 |
| `O+` / `O-` | 官网首页本机可达 / 不可达（未抓取正文） |
| **`LOGO+`** | **已下载官方 logo 文件并目视核对 + 本机取色（URL 见该行与 §4.2）** |
| `待核实` | 无本机可验证来源；「官方样式参考」按既有知识/部分证据填写，落地前需用户截图确认 |

### 1.3 Simple Icons 成员核验（本次实测 2026-09-28）

`https://cdn.simpleicons.org/<slug>` **10/10 全部 404** → 本组 10 项均**不在 Simple Icons**，无 CC0 图标可用、无锁定色值。这与 manifest 的 `official: false` / `color: null` 及 `tools/brand-colors.json` 无条目一致。

**推论（重要）**：Q1 裁决「颜色维持 Simple Icons 口径」对本组**不产生约束效果**（SI 无记录），因此本组颜色完全取决于用户对官方素材/官方取色的授权（Q2 / Q9 同路径）——见 §5 第 13 条。

### 1.4 官方素材与取色实测（2026-09-28）

| slug | 已获取的官方文件 | 尺寸 | 文件内取样主色 | 形态 | 来源 |
|---|---|---|---|---|---|
| 7artisans | `en.7artisans.com/Images/logo.png` | 276×51 | 红 `#D61518`（「7」）+ 白字 | 红「7」+ 小写「artisans」 | `LOGO+` |
| laowa | `www.laowalens.com/Public/Uploads/uploadfile/images/20210203/logo.png` | 528×92 | 青绿 `#00ADAE` | 几何斜切「LAOWA」+ 中文「老蛙」 | `LOGO+` |
| meike | `cdn.shopify.com/s/files/1/0251/3508/7676/files/LOGO_067ee7b9-6eef-4163-9017-592b167ef320.png?width=500` | 500×194 | 蓝 `#014099` | 小写「meike」几何镂空 + ® 角标 | `LOGO+` |
| samyang | `www.lksamyang.com/assets/images/img_footer-logo.png`（**母集团/公司站页脚，非镜头字标**） | 110×20 | 白（透明底） | 待核实 | `O+`（部分） |
| sirui | `www.sirui.com/static/img/logo.png` | 320×95 | 蓝 `#0C4DA2` | 蓝衬线「SIRUI」+ 蓝方徽记（椭圆负形山形/脚架 + 内含小字） | `LOGO+` |
| tokina | `tokinalens.com/media/img/header_logo.svg` | viewBox 226×34 | **官方蓝 `#2A3E92`（SVG 源 `<g fill>` 直读，非取样）** | 方正几何「TOKINA」（O 近圆角矩形、N/A 方正），宽扁 ≈6.6:1 | `LOGO+` |
| ttartisan | `www.ttartisan.com/static/upload/image/20241224/1735025319693036.png` | 1920×651 | 黑 `#000000` | 全大写「TTARTISAN」圆角几何单线（圆头笔画、等宽） | `LOGO+` |
| viltrox | `cdn.shopify.com/s/files/1/0104/0380/7298/files/logo_557cb041-10ff-4a6b-83fd-cd96d60fb19e.png?width=600` | 340×81 | 白（透明底；深底反白版） | 全大写**宽体斜体**「VILTROX」 | `LOGO+` |
| voigtlander | `www.voigtlaender.de/wp-content/uploads/2017/12/VOIG-alt-lang-schwarz-transparent.png`（官方站点 schema.org `Organization.logo`） | 1137×212 | 近黑 `#1B1C20` | **手写/书法**「Voigtländer」（混合大小写含 ä，长上扬连笔贯穿全词） | `LOGO+` |
| yongnuo | `nwzimg.weizhan.hk/contents/sitefiles3602/18013329/images/2338659.png` + `img.website.xin/contents/sitefiles3602/18013329/images/8149740.png` | 1920×90 / 1920×500 | 白字黑底；banner 橙色 `#F2601F` | 全大写粗斜体「YONGNUO」，**第二个「O」为光圈虹膜图形**；中文 slogan「永诺，亮出精彩」 | `LOGO+` |

补充实测：
- **官网可达性**：7artisans.com / en.7artisans.com ✅、laowalens.com ✅（中文站，安徽长庚光学）、meikeglobal.com ✅、sirui.com ✅、tokinalens.com ✅（© Kenko Tokina）、ttartisan.com ✅、viltrox.com ✅（Shopify）、voigtlaender.de ✅（Voigtländer GmbH / Divi）。**不可达/无镜头字标**：samyangoptics.com（DNS 不可解析）、samyanglens.com（**重定向至 `www.lksamyang.com/en/index.php`「LK SAMYANG」**）、samyang.com（`Samyang Group` / 삼양그룹，非镜头品牌站）、hkyongnuo.com 与 yongnuo.com（JS 渲染 / SSL 失败，仅静态资源可达）。
- **官方站点强调色（非商标色，待核实）**：ttartisan.com 表格表头 `rgb(38, 162, 57)`（绿）；hkyongnuo.com banner 橙 `#F2601F`。**不得**据此写入 `brand-colors.json`（避免把 UI 色误当品牌色）。
- **本机资产像素采样**（`web/brand/<slug>.png`，512px 主档）：本组 10 项**主变体与 `-mono` 变体均为纯黑 `#000000`**，`-light` 为纯白 `#FFFFFF`；宽度 737–1572px（`voigtlander` 最宽 1572×512；`laowa`/`meike`/`sirui` 最窄 737–757×512）。
- **字面参数**（`tools/gen-brand-assets.mjs` 的 `WORDMARKS`，当前实现的事实来源）：见 §3 各行「当前实现」列。

### 1.5 门禁机制现状（决定落地路径）

`tools/check-brand-colors.mjs`：
- 颜色锁定值 `colorLock(slug) = COLORS.icons[slug].colorful ? hex : (COLORS.originalColorOverride[slug] ?? null)`（第 140–141 行）；本组 10 项 → `null`。
- 第 143 行断言 `manifest.color === colorLock(slug)`；第 167–169 行对无颜色品牌断言 **主变体 `meanSat < 0.12`（必须近黑）**；有颜色品牌则断言主变体色相接近锁定色、`-mono` 近黑、`-light` 近白。
- 因此本组任何「颜色对齐」改动都必须**同时**改 `tools/brand-colors.json`（`originalColorOverride`）+ `web/brand/index.json`（manifest v5）+ 重生成资产，否则门禁必然失败。

---

## 2. 结论摘要

| 分类 | 项数 | 明细 |
|---|---|---|
| **保留不动** | **0** | ——（本组 10 项目前均为黑色通用排印，与官方字面/颜色存在可核实差异） |
| **仅颜色** | **1** | tokina（官方蓝 `#2A3E92` 已由官方 SVG 源直读，可直接引用） |
| **字形重排** | **7** | 7artisans、laowa、meike、sirui、ttartisan、viltrox、voigtlander（用现有 OFL 字体按官方排印风格重排字标，**不复制官方矢量/徽记/插画**） |
| **待截图定案** | **2** | samyang（官方镜头字标未取得）、yongnuo（「O=光圈虹膜」属官方图形，需授权素材或明确不复制口径） |
| 其中**需用户提供素材/截图才能落地** | **9** | 除 tokina 的色值外，全部 9 项（含 7 个字形重排 + samyang + yongnuo） |
| 其中**已有本机可核实官方色值** | **6** | tokina `#2A3E92`（SVG 源）、laowa `#00ADAE`、meike `#014099`、sirui `#0C4DA2`、7artisans `#D61518`、voigtlander `#1B1C20` |

---

## 3. 对照表（10 项）

> 本组**全部为原创排印**（非官方素材）；Simple Icons 无对应图标（10/10 404）。「拟改动作」四选一口径：颜色对齐 / 保留原创排印 / 用现有 OFL 字体按官方排印风格重排字标 / 暂不改。重排一律**不复制官方多色矢量、徽记与插画**（Q2 授权素材除外）。

| slug | 分组 | 显示名 | 官方样式参考 | 来源 | 当前实现 | 差异 | 拟改动作 | 素材许可 | 风险 |
|---|---|---|---|---|---|---|---|---|---|
| 7artisans | lens | 7Artisans | 红色放大「7」+ 小写「artisans」无衬线组合；红 `#D61518`；字距紧、无衬线几何、无点缀元素；站点页头为反白（白字深底）版 | `LOGO+` `en.7artisans.com/Images/logo.png`（276×51，取样 `#D61518`+白字；白字部分细节待核实）；`SI+` 404；`O+` 7artisans.com / en.7artisans.com（中文站为「七工匠」，深圳市七工匠光电科技） | 原创排印「7Artisans」Geist 600（字距 0），黑 `#000000`，1240×512；`-mono` 同黑、`-light` 白；无颜色记录 | **大小写**（`7Artisans` vs 官方 `7artisans`）；**缺品牌红**（官方「7」为红）；官方「7」显著放大并单独着色，当前数字与字母同重同色 | 用现有 OFL 字体按官方排印风格重排字标（候选：Geist 600/700，文本改「7artisans」+ 放大「7」比例约 1.2×、字距 0）；颜色对齐列为**待裁决**（若授权按 Q9 同路径取色 `#D61518`）；本次**暂不改** | 原创排印（OFL 字体）；官方标识经用户授权提供（Q2）；色值取样自官方站点文件，落地前需用户确认 | 商标；「7」放大比例无官方量化值，需 2–3 个样张比对；`#D61518` 为文件取样非官方色规范 |
| laowa | lens | Laowa | 几何无衬线全大写「LAOWA」：A/W 为**斜切笔画**、L 端部斜切；青绿（teal）`#00ADAE`；官方中文站字标右侧带中文「老蛙」 | `LOGO+` `www.laowalens.com/Public/Uploads/uploadfile/images/20210203/logo.png`（528×92，取样 `#00ADAE`）；`SI+` 404；`O+` laowalens.com（安徽长庚光学科技 / Venus Optics） | 原创排印「LAOWA」Geist 600（字距 +10），黑，757×512；无颜色记录 | **缺青绿主色**；字面不同（官方斜切几何 vs Geist 新怪诞）；官方另有中文「老蛙」联排（Q3 口径下画面保持拉丁） | 字形重排（按官方排印风格贴近斜切几何字面；现有 OFL 最近似为 Geist 700 字距 +12 或 BricolageGrotesque 600 字距 +8，**无同款斜切字面**）；颜色对齐列为**待裁决**（`#00ADAE`） | 原创排印（OFL 字体）+ 官方色值待授权取色（Q9 路径）；中文名仅用于界面显示名（Q3） | 商标；斜切字面在现有字体集内无法精确还原，属「近似」；青绿色对白底对比度偏低（≈2.4:1，浅底应强制 `-mono`） |
| meike | lens | Meike | 小写「meike」**几何镂空（stencil）**字标 + ® 角标；蓝 `#014099`；字腔开阔、笔画等宽、圆角矩形构成 | `LOGO+` `meikeglobal.com` 官方 Shopify 站点 LOGO（500×194，取样 `#014099`）；`SI+` 404；`O+` meikeglobal.com（© 2026 Meike Global） | 原创排印「MEIKE」Geist 700（字距 +6），黑，737×512；无颜色记录 | **大小写**（MEIKE vs meike）；**缺蓝主色**；**字面方向不同**（几何镂空 vs 实心新怪诞）；® 角标缺失（本轮不复制 ®） | 用现有 OFL 字体按官方排印风格重排字标（候选：Onest 600 字距 +2 或 BricolageGrotesque 500 字距 +4，**无镂空字面**）；颜色对齐列为**待裁决**（`#014099`） | 原创排印（OFL 字体）+ 官方色值待授权取色（Q9 路径） | 商标；镂空构造无法用现有字体还原，需用户接受「近似」；改小写后与 EXIF 匹配无关（slug 不变） |
| samyang | lens | Samyang | **待核实**：官方**镜头**字标未取得。已核实：镜头品牌官网 `samyanglens.com` 现**重定向至 `www.lksamyang.com/en`（"LK SAMYANG"，集团/公司口径）**，其页脚 logo 为透明底白字（110×20，非镜头字标）；`samyang.com` 为 `Samyang Group`（삼양그룹，非本品牌）；`samyangoptics.com` 本机 **DNS 不可解析** | `SI+` 404；`O-` samyangoptics.com（DNS 失败）；`O+` lksamyang.com（**非镜头字标**）；**待核实（原因：镜头字标站点不可达 / 需用户截图）** | 原创排印「SAMYANG」Geist 600（字距 +8），黑，1029×512；无颜色记录 | 无法比对（无官方镜头字标来源）。已知信息：品牌归属方站点已并入 LK SAMYANG 集团口径 | **暂不改**（保留原创排印）；待用户提供官方镜头字标（镜头桶身刻字或官方页截图）后再定字体/颜色 | 原创排印（OFL 字体）；官方标识经用户授权提供（Q2） | 商标；若官方已启用新字标（集团口径），沿用旧名/旧字面可能被判定「不符合官方设计」（与 Q4 旧名口径的一致性需一并裁决，见 §5 第 21 条） |
| sirui | lens | Sirui | **蓝色衬线**字标「SIRUI」（有衬线、笔画对比明显）+ 左侧**蓝色方形徽记**（椭圆内以负形构成山形/脚架意象，徽记内含小字 SIRUI）；蓝 `#0C4DA2` | `LOGO+` `www.sirui.com/static/img/logo.png`（320×95，取样 `#0C4DA2`）；`SI+` 404；`O+` sirui.com（思锐，中文站页头 `/static/img/logo.png`） | 原创排印「SIRUI」Geist 700（字距 +10），黑，757×512；无颜色记录 | **字体方向不同**（当前无衬线 vs 官方衬线）；**缺蓝主色**；官方含方徽记（不复制）；字距当前偏宽 | 字形重排（衬线方向；候选 PlayfairDisplay 700 / NotoSerifSC 700 / Fraunces 600，字距 +6），**不复制方徽记图形**；颜色对齐列为**待裁决**（`#0C4DA2`） | 原创排印（OFL 字体）+ 官方色值待授权取色（Q9 路径） | 商标；「无衬线→衬线」属方向性变更，将与本组其余 9 项的无衬线族产生视觉反差，需用户确认是否可接受；蓝对白底对比度 ≈7.8:1（可用） |
| tokina | lens | Tokina | 方正几何全大写「TOKINA」：O 为近圆角矩形、N/A 方正、笔画等宽；**官方蓝 `#2A3E92`**（自官方 header SVG 的 `<g fill>` 直读，非取样）；比例宽扁（226×34 ≈ 6.6:1） | `LOGO+` `tokinalens.com/media/img/header_logo.svg`（**SVG 源色 `#2A3E92`**，同站另有 footer_logo.svg）；`SI+` 404；`O+` tokinalens.com（© Kenko Tokina Co., Ltd. 2026） | 原创排印「TOKINA」Geist 700（字距 +6），黑，876×512（比例 ≈1.71:1）；无颜色记录 | **颜色缺失**（黑 vs 官方蓝 `#2A3E92`，色值可直接引用）；**字面不同**（方正几何 vs 新怪诞）；**比例不同**（官方宽扁字标 vs 当前近方） | **颜色对齐**：将 `#2A3E92` 写入 `tools/brand-colors.json`（`originalColorOverride`，与 canon 同路径）→ manifest v5 → 重生成；字形可保留（或后续按 §5 第 15 条微调字面） | 原创排印（OFL 字体）+ 官方色值（**自官方 SVG 源直读，无需猜测/取色授权**） | 商标；本组唯一「色值已确证」项，落地风险最低；改色后需同步 `check-brand-colors` 断言（主变体色相 ±45°、`-mono` 保持黑） |
| ttartisan | lens | TTArtisan | 全大写「TTARTISAN」**圆角几何单线**字标（笔画端圆头、粗细等宽、字腔通直）；黑 `#000000`；无点缀色。站点表格强调色为绿 `rgb(38,162,57)`（**待核实**，疑为网站 UI 色） | `LOGO+` `www.ttartisan.com/static/upload/image/20241224/1735025319693036.png`（1920×651，取样 `#000000`）；`SI+` 404；`O+` ttartisan.com（TTARTISAN / 铭匠，深圳） | 原创排印「TTArtisan」Geist 600（字距 0），黑，1240×512；无颜色记录 | **大小写**（TTArtisan vs 官方全大写 TTARTISAN）；**字面不同**（官方圆角单线 vs Geist 直角怪诞）；颜色一致（黑） | 用现有 OFL 字体按官方排印风格重排字标（先修大小写为 `TTARTISAN`，字距 +2；圆角几何字面在现有字体集中**无对应字体**，候选 Onest 600 字距 +4 或按 §5 第 18 条评估引入新 OFL 字体）；**暂不改**直至裁决 | 原创排印（OFL 字体）；官方标识经用户授权提供（Q2） | 商标；字体集缺圆角几何体，若强行近似可能「不像官方」；站点绿 `rgb(38,162,57)` 若被误用为品牌色会污染门禁 |
| viltrox | lens | Viltrox | 全大写**宽体斜体**「VILTROX」（明显倾斜 + 宽字面）；已获取文件为**透明底白字**（深底反白版）；品牌强调色**待核实** | `LOGO+` `viltrox.com` 官方 Shopify 站点 logo（340×81，取样仅白 `#FFFFFF`）；`SI+` 404；`O+` viltrox.com（© 2026 Viltrox Store） | 原创排印「VILTROX」Geist 700（字距 +6），黑，1015×512；无颜色记录 | **倾斜/宽度未体现**（当前直立常规宽）；无官方色信息；官方文件为反白版（需浅底/深底两用口径） | 用现有 OFL 字体按官方排印风格重排字标（可行部分：加大字距至 +10~+12 近似宽体）；**倾斜**需斜体 OFL 字体或在 `gen-brand-assets.mjs` 新增 skew 参数（**属工具改动，须裁决**）；颜色**待核实**；本次**暂不改** | 原创排印（OFL 字体）；官方标识经用户授权提供（Q2） | 商标；斜体字面缺口，若用矩阵变换模拟可能影响字形轮廓抽检口径（主报告 §4.2 第 6 步）；白色文件无法确定品牌色 |
| voigtlander | lens | Voigtlander | **手写体/书法**字标「Voigtländer」：混合大小写、首字母与长连笔贯穿全词、尾部显著上扬收笔；含**变音符 ä**；近黑 `#1B1C20`（官方站点 schema.org `Organization.logo`，说明「长版黑字透明底」为其官方主用形态之一） | `LOGO+` `www.voigtlaender.de/wp-content/uploads/2017/12/VOIG-alt-lang-schwarz-transparent.png`（1137×212，取样 `#1B1C20`；文件名含 `alt`（旧版）字样，**是否存在更新版字标待用户截图核实**）；`SI+` 404；`O+` voigtlaender.de（Voigtländer GmbH） | 原创排印「VOIGTLANDER」InstrumentSerif 400（字距 +6），黑，1572×512；无颜色记录 | **方向性差异（本组最大）**：当前为**全大写高对比衬线**，官方为**手写书法体**；**变音符缺失**（画面为 ASCII `VOIGTLANDER`）；连笔/上扬点缀完全缺失 | 用现有 OFL 字体按官方排印风格重排字标（现有字体集中**唯一手写体**为 `GreatVibes-400.ttf`，候选改混合大小写「Voigtländer」；或保留 InstrumentSerif 但改混合大小写）；**变音符需先扩展子集**（见 §1.4 / §5 第 17 条）；官方素材到位后可直接启用官方标识（Q2）；本次**暂不改** | 原创排印（OFL 字体）；官方标识经用户授权提供（Q2） | 商标；**子集字形风险**：`templates/assets/fonts/_subset-chars.txt` 现**不含** `ä/Ä/ö/ü/ß/É/è`，带变音符渲染会缺字（须跑 `tools/check-glyph-coverage.mjs` 并重做子集）；官方旧/新字标版本差异（文件名 `alt`）可能改变结论；显示名「Voigtlander」与官方拼写不一致 |
| yongnuo | lens | Yongnuo | 全大写**粗斜体**「YONGNUO」，其中**第二个「O」替换为光圈虹膜（aperture/iris）图形**（品牌识别核心元素）；站点物料另见橙色点缀（banner 取样 `#F2601F`，**待核实**）；中文 slogan「永诺，亮出精彩」 | `LOGO+` `hkyongnuo.com` 静态资源（`nwzimg.weizhan.hk/.../2338659.png`，1920×90，白字黑底；`img.website.xin/.../8149740.png`，1920×500，含橙 `#F2601F`）；`SI+` 404；`O+` 静态资源可达（站点为 JS 渲染，`yongnuo.com` SSL 握手失败） | 原创排印「YONGNUO」Geist 600（字距 +6），黑，1015×512；无颜色记录 | **图形元素缺失**（官方「O→光圈」为图形标识，按红线**不得复制**）；倾斜字面未体现；站点橙 `#F2601F` 性质待核实（UI 色 vs 品牌色） | **暂不改**（保留原创排印）；官方「光圈 O」属官方标识范畴 → 需用户提供**授权素材**后按 Q2 启用官方标识；若仅排印贴近，可选斜体方向（同 viltrox 的工具限制）；中文显示名「永诺」列入 §5 第 20 条 | 原创排印（OFL 字体）；官方标识经用户授权提供（Q2） | 商标；官方识别核心为图形元素，「纯排印」还原度天然受限；橙色若被误认品牌色会污染门禁 |

---

## 4. 总结与批量落地建议

### 4.1 分类统计（10 项）

| 分类 | 数量 | 明细 |
|---|---|---|
| 保留不动 | 0 | —— |
| 仅颜色 | 1 | tokina（`#2A3E92`，官方 SVG 源直读，可直接落地） |
| 字形重排 | 7 | 7artisans、laowa、meike、sirui、ttartisan、viltrox、voigtlander |
| 待截图定案 | 2 | samyang、yongnuo |
| （口径）需用户提供素材/截图才能落地 | 9 | 上表除 tokina 色值外的全部 9 项 |
| （口径）现有 OFL 字体可完成的字形重排 | 5 | laowa（近似）、meike（近似）、sirui（衬线方向）、voigtlander（需先扩子集）、7artisans |
| （口径）现有字体集**无法**完整还原、需新字体或工具改动 | 3 | ttartisan（圆角几何体）、viltrox（斜体/宽体）、yongnuo（斜体 + 官方图形） |

### 4.2 需用户提供的官方素材清单（Q12 扩围项，10 条）

> 交付目录 `D:\FrameGeist\brand-official-inbox\`（已 gitignore，仅作素材入口，不随包分发）；命名 `<slug>.png`（同品牌多视角加 `-2`、`-3`）；格式 PNG 透明底（宽度 ≥1000px 最佳）/ SVG / 高清截图；需含字标正面、字距、颜色与点缀元素。

| # | slug | 名称 | 需要的素材 | 备注（本机已核实的官方素材位置，供用户取用/授权） |
|---|---|---|---|---|
| 1 | 7artisans | 7Artisans / 七工匠 | 官方字标正面（含红色「7」与「artisans」大小写、比例） | 已核实：`en.7artisans.com/Images/logo.png`（红 `#D61518`） |
| 2 | laowa | Laowa / 老蛙 | 官方字标正面（含斜切字面细节与青绿 `#00ADAE`） | 已核实：`www.laowalens.com/Public/Uploads/uploadfile/images/20210203/logo.png` |
| 3 | meike | Meike | 官方字标正面（小写「meike」镂空字面 + 蓝 `#014099`） | 已核实：`meikeglobal.com` 站点 LOGO（500×194） |
| 4 | samyang | Samyang | **官方镜头字标**正面（镜头桶身刻字或官方页截图；含是否已更名） | 未取得：`samyangoptics.com` DNS 失败；`samyanglens.com` 重定向至 `lksamyang.com` |
| 5 | sirui | Sirui / 思锐 | 官方字标正面（衬线字面 + 蓝 `#0C4DA2`）；方徽记仅在用户要求「使用官方标识」时提供 | 已核实：`www.sirui.com/static/img/logo.png`（320×95） |
| 6 | tokina | Tokina | 官方字标正面（方正几何字面 + 宽扁比例）；色值已确证，可只给形态 | 已核实：`tokinalens.com/media/img/header_logo.svg`（`#2A3E92`） |
| 7 | ttartisan | TTArtisan / 铭匠 | 官方字标正面（全大写圆角几何单线字面） | 已核实：`www.ttartisan.com/static/upload/image/20241224/1735025319693036.png` |
| 8 | viltrox | Viltrox | 官方字标正面（宽体斜体）；**彩色版**（现有文件为透明底白字，无法定色） | 已核实：`viltrox.com` 站点 logo（340×81，白） |
| 9 | voigtlander | Voigtländer | 官方字标正面（手写体 + 变音符 ä）；**并确认新旧版本**（现有官方文件名为 `VOIG-alt-lang`，`alt`=旧） | 已核实：`www.voigtlaender.de/wp-content/uploads/2017/12/VOIG-alt-lang-schwarz-transparent.png` |
| 10 | yongnuo | Yongnuo / 永诺 | 官方字标正面（粗斜体 + 「O=光圈虹膜」图形）；含品牌色说明 | 已核实：`hkyongnuo.com` 静态资源（白字黑底 / banner 橙 `#F2601F`） |

**清单条目数：10 条。** 其中 8 条本机已找到官方文件位置（用户可直接下载授权入库），2 条（samyang、viltrox 彩色版）需要用户另行提供。

### 4.3 落地技术要点（只读审计建议）

1. **颜色路径（仅 tokina 已可执行）**：`tools/brand-colors.json` 的 `originalColorOverride` 增加 `tokina: "#2A3E92"`（与 `canon: "#C8102E"` 同机制）→ `web/brand/index.json` 升 v5 并写 `color: "#2A3E92"` → 重生成 `web/brand/*`、`templates/assets/brand/*`（含 `thumbs/`）、`templates/assets/lockup/*` → `node tools/check-brand-colors.mjs` 全绿。**注意**：门禁第 143 行要求 manifest 与 lock 文件严格一致，且第 167 行对无颜色品牌的「近黑」断言会被该改动替代。
2. **字形重排**：只改 `tools/gen-brand-assets.mjs` 的 `WORDMARKS` 条目（字体、字重、字距、文本），不改资产矩阵与路径；`LENS_ONLY` 常量与 slug 保持不变（EXIF 兼容）。`templates/assets/brand/CREDITS.json` 的 `font` 字段需同步（本组 10 项现均登记为 Geist/InstrumentSerif）。
3. **浅色底强制 `-mono`（Q10 同口径）**：本组若引入官方彩色（laowa 青绿、meike/sirui/tokina 蓝、7artisans 红），深色模板用彩色主变体，浅色模板**强制**用 `-mono` 黑变体；`-light` 保持纯白。
4. **字体缺口前置检查**：任何含 `ä` 的文本（voigtlander）**必须先**确认 `templates/assets/fonts/_subset-chars.txt` 与目标 TTF 覆盖该码位（当前子集**不含** `ä/Ä/ö/ü/ß`），并跑 `tools/check-glyph-coverage.mjs`；否则回退 ASCII `Voigtlander`。
5. **新字体引入**：ttartisan（圆角几何）、viltrox/yongnuo（斜体）在现有 72 个 OFL 字体文件中无对应；如引入新字体现走 `tools/fetch-fonts.mjs` + `tools/font-pins.json` 流程（属资产新增，须在审核时确认）。
6. **素材到位后**：官方标识（经授权）优先于原创排印（Q2/Q7 口径）；用户将文件放入 `brand-official-inbox/<slug>.png`，由生成器接入并按变体矩阵输出，随后跑色值/像素门禁与字形轮廓抽检。

---

## 5. 待用户裁决的问题（编号接续主报告 §5 / §6）

13. **颜色口径（本组特殊）**：本组 10 项在 Simple Icons **全部 404**，Q1「维持 SI 口径」对其**无约束力** → 是否按 Q9 同路径「授权按官网取色并记录来源」，把已核实的 6 个色值写入 `tools/brand-colors.json`？（tokina `#2A3E92`、laowa `#00ADAE`、meike `#014099`、sirui `#0C4DA2`、7artisans `#D61518`、voigtlander 近黑 `#1B1C20`）
14. **官方素材 vs 原创排印**：本组是否统一走 Q2「官方标识经授权可用」？若走，需按 §4.2 逐项提供素材；若不走，则全部保留原创排印。
15. **大小写口径**：官方为 `7artisans` / `meike`（小写）、`TTARTISAN`（全大写）；当前实现为 `7Artisans` / `MEIKE` / `TTArtisan`。是否按官方大小写统一？（影响 3 项字面宽度与缩略图裁切）
16. **Sirui 衬线方向**：是否接受把 `SIRUI` 从无衬线改为**衬线**（官方为衬线字标）？是否需要在「使用官方标识」时一并使用官方蓝色方徽记（否则只做字标）？
17. **Voigtländer 变音符**：是否在画面使用带 `ä` 的「Voigtländer」？若是，需先扩展字体子集（当前不含该码位）；是否同时把界面显示名改为「Voigtländer」？
18. **字体缺口处理**：ttartisan（圆角几何）、viltrox/yongnuo（斜体宽体）在现有 OFL 字体集中无对应 → 引入新 OFL 字体（新资产 + 门禁同步），还是接受「近似排印」并在报告中标注？
19. **Yongnuo「光圈 O」**：该图形是官方识别核心，按红线不可复制 → 是否按 Q2 以授权素材形式启用官方标识，或明确「仅纯排印、不含图形」？
20. **中文显示名（Q3 同口径）**：是否在 zh-CN 界面显示名中启用「七工匠 / 老蛙 / 铭匠 / 思锐 / 永诺」等（画面拉丁字标不变）？「Voigtländer」是否显示为带变音符原文？
21. **品牌归属/新名口径**：`samyanglens.com` 已重定向至集团站 `lksamyang.com`（"LK SAMYANG"）→ 沿用 Q4 旧名口径保留画面「SAMYANG」，还是按新口径核对？（本项素材未取得，需用户裁定后再定字标）
22. **`-mono` 强制范围**：本组引入官方彩色后，浅色模板是否一律强制 `-mono` 黑变体（Q10 同口径），并接受深色模板保留青色/蓝色等低对比色？
23. **交付清单状态**：`brand-delivery-checklist.md` 第三优先段现写「补充审计报告：…（生成中）」→ 落地批次是否一并更新为「已生成」并补上本报告 §4.2 的 10 条细化要求？

---

## 附录 A：官网与官方素材可达性实测（2026-09-28）

| 目标 | 结果 | 目标 | 结果 |
|---|---|---|---|
| 7artisans.com / en.7artisans.com | 200 ✅（已抓取；logo 在 `Images/logo.png`） | tokinalens.com | 200 ✅（已抓取；header/footer logo SVG） |
| laowalens.com | 200 ✅（已抓取；logo `Public/.../20210203/logo.png`） | ttartisan.com | 200 ✅（已抓取；logo 2024-12-24 资源） |
| meikeglobal.com | 200 ✅（已抓取；Shopify logo） | viltrox.com | 200 ✅（已抓取；Shopify logo） |
| sirui.com | 200 ✅（已抓取；`static/img/logo.png`） | voigtlaender.de | 200 ✅（已抓取；schema.org logo PNG） |
| samyangoptics.com | **DNS 不可解析 ❌** | samyanglens.com | 200 → **重定向 `lksamyang.com/en`（集团口径）** |
| samyang.com | 200（`Samyang Group`，非镜头品牌站） | hkyongnuo.com | 200（JS 渲染；正文/图像仅静态资源可达） |
| yongnuo.com | **SSL/TLS 握手失败 ❌** | cdn.simpleicons.org | 200（本组 10 项均 404） |

> 注：本组未使用 `websearch`（不可用）；所有 URL 均为本机实际 fetch 结果，**未抓取正文的站点不推断其徽标形态**。

## 附录 B：Simple Icons 成员核验结果（本次 10 项）

- **本组 10/10 全部不在 Simple Icons**（`https://cdn.simpleicons.org/<slug>` → 404）：7artisans、laowa、meike、samyang、sirui、tokina、ttartisan、viltrox、voigtlander、yongnuo。
- 因此本组**无 CC0 图标资产可用**，10 项均为 `web/brand/` 内的**原创排印**（OFL 字体渲染），颜色记录为空（`color: null`、`official: false`）。

## 附录 C：本机官方文件取色记录（**未落地**，需 Q9 同路径授权）

| slug | 取样来源 | 取样值 | 可靠性 |
|---|---|---|---|
| tokina | 官方 `header_logo.svg` 的 `<g fill>` | `#2A3E92` | **高**（矢量源色，非渲染取样） |
| laowa | 官方 logo PNG 像素众数 | `#00ADAE` | 中高（单一色平面为主） |
| meike | 官方 logo PNG 像素众数 | `#014099` | 中高 |
| sirui | 官方 logo PNG 像素众数 | `#0C4DA2` | 中高 |
| 7artisans | 官方 logo PNG（红「7」） | `#D61518` | 中（文件含反白文字，红仅取自数字） |
| voigtlander | 官方 logo PNG 像素众数 | `#1B1C20`（近黑） | 中高（官方主用黑版） |
| yongnuo | 站点 banner | `#F2601F`（橙） | **低**（疑 UI/营销色，待核实） |
| ttartisan | 官方 logo PNG | `#000000` | 高（黑） |
| viltrox | 官方 logo PNG（透明底白字） | `#FFFFFF`（非品牌色） | **无**（无法定色，待用户提供彩色版） |
| samyang | 集团站页脚 logo（非镜头字标） | `#FFFFFF`（非品牌色） | **无**（待提供镜头字标） |

> 所有取样值**均为审计留档，不得在用户确认前写入 `tools/brand-colors.json`**（避免把错误色值经门禁固化，同主报告 §4.2 第 1 步口径）。
