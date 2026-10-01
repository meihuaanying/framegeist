# FrameGeist v1.2.0 — 镜头系列 / 游戏字标 素材官方可获得性侦察

- 侦察日期：2026-10-01
- 范围：`manifest v5` 的 `series` 组 12 项 + `game` 组 6 项 = **18 项**
- 性质：**只读侦察**。本文件是唯一新增文件，未修改仓库任何其他文件。
- 方法：仅用 HTTP 直抓（Code Mode `fetch` 等价于 webfetch，已禁用 websearch）。每条结论均附实测 status / content-type / 字节数。

## 0. 关键计数校正

任务书称「13 枚镜头系列徽章」，但实测 manifest v5 的 `series` 组是 **12 项**：

- `web/brand/index.json` → `groups.series.length = 12`
- 其中 `nikon-s` 已有官方素材（`officialAsset: "nikon-s.svg"`, `sourceUrl: https://imaging.nikon.com/imaging/lineup/lens/z-mount/`, `accent: "#FFE100"`）
- 故**待补 series = 11 项**（任务书列的 11 个 slug 与之一致）
- `groups.game.length = 6` → **待补 game = 6 项**
- **合计待补 = 17 项**；含 `nikon-s` 参照项则本报告覆盖 18 项。

> 差异来源：`brand-official-inbox/SOURCES.json` 的 `seriesCoverage.requested` 列出 **13** 个 slug，多出的一个是 `canon-rf-l`；v1.1.0 裁决 6「只保留 L」后 `canon-rf-l` 已从 series 组移除（`templates/assets/series/` 中两个文件已删除，模板/E2E 引用数均为 0）。故 13 → 12 是历史遗留，非本次缺失。

## 1. 当前实现状态（manifest v5 + 资产几何）

### 1.1 manifest 字段现状

`groups.series` 全部 12 项：`official: false`；`color: null`（除 `nikon-s` 无 color 但有 `accent`）；仅 `nikon-s` 有 `officialAsset` + `sourceUrl` + `accent`。
`groups.game` 全部 6 项：仅 `slug` + `label` + `official:false` + `color:null`，**无任何 officialAsset / sourceUrl / accent**。

即：**18 项中 official=true 者 0 项**，与 v1.1.0 记录一致。

### 1.2 资产几何（`node target/png-dims.mjs`）

series（canvas 高一律 512；`xxx.png` 与 `xxx-light.png` 几何完全一致）：

| slug | canvas | ink | aspect | padX | padY |
|---|---|---|---|---|---|
| sony-gm | 311x512 | 311x160 | 1.94 | 0/0 | 176/176 |
| sony-g | 173x512 | 138x160 | 0.86 | 17/18 | 176/176 |
| canon-l | 173x512 | 81x155 | 0.52 | 46/46 | 174/183 |
| sigma-art | 458x512 | 432x154 | 2.81 | 14/12 | 179/179 |
| sigma-dgdn | 727x512 | 649x160 | 4.06 | 39/39 | 176/176 |
| sigma-apo | 464x512 | 455x160 | 2.84 | 2/7 | 176/176 |
| hasselblad-xcd | 458x512 | 441x160 | 2.76 | 6/11 | 176/176 |
| fujifilm-xf | 315x512 | 269x154 | 1.75 | 20/26 | 179/179 |
| zeiss-batis | 747x512 | 588x160 | 3.67 | 83/76 | 176/176 |
| leica-apo | 464x512 | 324x159 | 2.04 | 64/76 | 172/181 |
| tamron-sp | 315x512 | 277x160 | 1.73 | 20/18 | 176/176 |
| nikon-s（已官方） | 512x512 | 512x112 | 4.57 | 0/0 | 200/200 |

game：

| slug | canvas | ink | aspect | padX | padY |
|---|---|---|---|---|---|
| genshin | 1029x512 | 977x142 | 6.88 | 30/22 | 187/183 |
| zzz | 470x512 | 470x162 | 2.90 | 0/0 | 175/175 |
| honkai | 888x512 | 838x160 | 5.24 | 25/25 | 176/176 |
| arknights | 1294x512 | 1035x179 | 5.78 | 129/130 | 177/156 |
| wwmeet | 1714x512 | 1490x303 | 4.92 | 103/121 | 113/96 |
| wukong | 900x512 | 799x180 | 4.44 | 48/53 | 176/156 |

观察：series 全部 ink 高 ≈154–160（统一字标带高），game ink 高 142–303（不统一，`wwmeet` 明显偏高）。所有 `-light` 与主文件几何一致，说明现资产是「单色墨迹 + 手工补光版」，`recolour-with-accent` 可保几何不变。

### 1.3 落地机制（只读确认，未改动）

`tools/import-brand-inbox.mjs:98-101` 有 `SERIES_ACCENT` 白名单，目前仅 `{"nikon-s": "#FFE100"}`；注释明写「其余 12 项保持单色直到官方素材到位」。`:530` 在 `group === "series"` 时注入 `accent`。game 组目前**没有**对应的 accent 机制。

### 1.4 仓库内既有官方品牌色（仅作对照，非本次答案）

`tools/brand-colors.json` → `originalColorOverride` 已含 v1.1.0 核验过的官方母品牌色，可作为 `recolour-with-accent` 的**母品牌**色来源（但**不是**系列标识的官方色）：

| 母品牌 | hex |
|---|---|
| canon | `#C8102E` |
| leica | `#E20713` |
| zeiss | `#102EB3` |
| nikon | `#FEE316` |

`sony` / `tamron` / `sigma` / `hasselblad` / `fujifilm` 在 `originalColorOverride` 中**无条目** → 这些母品牌连母色都需用户提供。

---

## 2. 镜头系列 11 项逐项结论

> 方法说明：先用 Code Mode `fetch` 抓官网页面（等价 webfetch），再从 HTML 中枚举 `src`/`href`/`url()` 的图片引用。
> **判定标准**：只有当官方站点上存在**可独立下载的图形文件**（PNG/SVG/AI/EPS）且该图形就是系列标识本身时，才算 `ingest-official`。

### 2.1 `sony-gm` / `sony-g`（Sony G Master、G）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取**（网络受限，非「不存在」）。`https://www.sony.com/` 返回 **403**（实测 `status=403 ct=text/html len=183`），无法进入产品页枚举素材。`https://www.sony.net/` 302 跳 `sony.co.jp/en/`（**200**，len=241383），但该站为日本综合门户，**无 G Master / G 镜头产品线**。 |
| 2. 官方如何呈现 | 未取得证据页（403）。已知 Sony 的 G Master / G 是**镜身刻字 + 包装彩色牌**（「G」为红色圆环+字母，「G Master」为红色底白字铭牌）。**本项为业界常识推断，非本次实测证据，需复核。** |
| 3. 官方点缀色 | **需用户提供**。`tools/brand-colors.json` 的 `originalColorOverride` 中 **无 sony 条目**。任务书提到的「Sony 红约 #E4002B」仅作对照，**未在本次抓取的官方页面上取到该值，不作为答案**。 |
| 4. 当前实现 | `sony-gm`: `official:false, color:null`，无 accent/officialAsset。资产 `templates/assets/series/sony-gm.png` = canvas 311x512, ink 311x160, aspect 1.94, padX 0/0, padY 176/176。`sony-g`: `official:false, color:null`。资产 `sony-g.png` = canvas 173x512, ink 138x160, aspect 0.86, padX 17/18, padY 176/176。 |
| 5. 建议动作 | `sony-gm` → **keep-mono**（本机无法取证 Sony 官方素材，且 G Master 有官方彩色铭牌，单色化会丢失官方彩色标识的语义；维持单色并记录「需用户提供」）<br>`sony-g` → **keep-mono**（同组理由） |

> ⚠️ 若用户能提供 Sony 官方 G / G Master 铭牌照片或品牌素材手册扫描，应改为 `ingest-official`。

### 2.2 `canon-l`（Canon L 系列）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取**。抓取 `https://www.canon.com.cn/`（**200**, `text/html`, len=176832）中所有 logo 引用仅得：`canonLogommeta.png`、`logo_new_2026.jpg`、`header20260813/logo_culture.svg`、`logo4.png`、`logo_yayun.jpg` — **均为 Canon 母品牌/文化口号，无 L 系列徽标**。`https://www.canon.com.cn/product/ef/index/index.html`（**200**, len=181643, 123 张图引用）中筛选 `l_/lens/ef/badge/series` 无任何 L 系列徽标文件。 |
| 2. 官方如何呈现 | Canon L 系列标识在官网**以镜身刻字/镜筒上的红色 L 标 + 产品名排印出现**，产品页不提供可下载的 L 徽标图。证据页：`https://www.canon.com.cn/product/ef/index/index.html`（200，123 图引用中无 L 徽标）、`https://www.canon.com.cn/overview/efwidezoom.html`（200, len=212692，图片仅 `/Public/Front/images/logo1.png`、`logo2.png` 等母品牌资产）。 |
| 3. 官方点缀色 | **母品牌红可从仓库取到**：`tools/brand-colors.json` → `originalColorOverride.canon = #C8102E`（v1.1.0 已核验）。**L 系列自身的官方色值本次未在官网取到 → 需用户提供。**（对照值 Canon 红 #CC0000 不作为答案） |
| 4. 当前实现 | `canon-l`: `official:false, color:null`。资产 `canon-l.png` = canvas 173x512, ink 81x155, aspect 0.52, padX 46/46, padY 174/183。<br>注：v1.1.0 PROGRESS.md 记载「裁决 6 只保留 L…canon-l 已是单独 L + 官方红」，但 manifest 中 `canon-l.color` 仍为 `null` — **报告与实现存在出入，需核对**。 |
| 5. 建议动作 | **keep-mono**，或（若认可 Canon 母品牌红为该标识色）**recolour-with-accent #C8102E**。倾向 keep-mono：Canon 未公开发布 L 徽标文件，单色 L 字标 + 品牌红点缀是合理近似，但严格意义上 L 标本身即红色，应由用户提供官方 L 铭牌素材后 `ingest-official`。 |

### 2.3 `sigma-art` / `sigma-dgdn` / `sigma-apo`

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取（较确证：官方未发布）**。抓取 `https://www.sigma-global.com/en/lenses/a026_85_12/`（ART 产品页，**200**, len=39915, 34 张图引用）中**无任何 ART/ART 系列徽标文件** — 图片仅 touch-icon 与 `/lenses/images/a026_85_12_product_img01.png` 产品图。`c026_20_60_28_4`（APO 产品页，**200**, len=36954, 35 图引用）同样无徽标文件。`/en/lenses/our-lenses/`（**200**, len=26631, 22 图引用）中 logo 相关项**全部是 apple-touch-icon**，无 ART/APO/DG DN 标识。 |
| 2. 官方如何呈现 | **网页纯文字排印**。ART 产品页源码中该标识为普通 HTML 标题文字，非图形：<br>`<h2 class="f-h2 --text-center --spacing-0 "><p class="first-child">ART</p> <p class="last-child">85mm F1.2 DG</p></h2>`<br>证据页：`https://www.sigma-global.com/en/lenses/a026_85_12/`（200）、`https://www.sigma-global.com/en/lenses/our-lenses/`（200）。页内 `<svg>` 标签数 = **0**，`background-image:url()` 数 = **0**。<br>注：`/en/lenses/?categories=art` 与 `?categories=apo` 返回**完全相同的 56670 字节 JS 壳页**，分类筛选靠客户端 JS，静态抓取无法枚举 → 存在「筛选态下另有徽标图」的残余可能，但产品详情页证据已足以支撑「无独立徽标文件」。 |
| 3. 官方点缀色 | **需用户提供**。`tools/brand-colors.json` 的 `originalColorOverride` **无 sigma 条目**；Sigma 官网未见公开品牌色声明（ART/DG DN/APO 均为无彩色标识）。 |
| 4. 当前实现 | 三项均 `official:false, color:null`，无 officialAsset/accent。几何：<br>`sigma-art.png` canvas 458x512, ink 432x154, aspect 2.81, padX 14/12, padY 179/179<br>`sigma-dgdn.png` canvas 727x512, ink 649x160, aspect 4.06, padX 39/39, padY 176/176<br>`sigma-apo.png` canvas 464x512, ink 455x160, aspect 2.84, padX 2/7, padY 176/176 |
| 5. 建议动作 | `sigma-art` → **keep-mono**<br>`sigma-dgdn` → **keep-mono**<br>`sigma-apo` → **keep-mono**<br>理由：Sigma 三个系列在官网**均为无彩色的文字标识**（见上），官方本身不存在彩色版，套色反而是臆造。 |

### 2.4 `tamron-sp`（Tamron SP）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取（较确证：官方未发布）**。抓取 `https://www.tamron.com/global/consumer/sp/`（**200**, len=69389）全部 28 个图片引用中，与 SP 相关的**全部是生活化场景缩略图**（`emount_thumbnail_en.webp`、`90mm_en_thumbnail.webp`、`impression.webp`、`photosample.webp` 等），**无 SP 字标徽标文件**。站点图标的 `https://www.tamron.com/common/svg/sprite.svg`（**200**, `image/svg+xml`, **86610 字节**, 81 个 `<symbol>`）经枚举 id 全部为：arrow_*/blank/camera/cart/check/close/company/document/filter/global/**logo**/mail/mail_02/management/… — 唯一含 `logo` 的是**母品牌 Tamron logo**，**无 SP**。 |
| 2. 官方如何呈现 | **网页纯文字排印**。SP 页内联 `<svg>` 全部是导航/页脚图标（`<use xlink:href="/common/svg/sprite.svg#global">` 等 8 处），SP 标识本身是 HTML 文本。证据页：`https://www.tamron.com/global/consumer/sp/`（200）。 |
| 3. 官方点缀色 | **需用户提供**。`originalColorOverride` 无 tamron 条目；Tamron SP 官网标识为无彩色文字。 |
| 4. 当前实现 | `official:false, color:null`。`tamron-sp.png` canvas 315x512, ink 277x160, aspect 1.73, padX 20/18, padY 176/176。 |
| 5. 建议动作 | **keep-mono**（官方 SP 为无彩色文字标识，无色可取）。 |

### 2.5 `hasselblad-xcd`（Hasselblad XCD）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取（较确证：官方未发布）**。`https://www.hasselblad.com/x-system/lenses/`（**200**, len=484233）与 `https://www.hasselblad.com/x-system/lenses/xcd-35-100e/`（**200**, len=564193）中 XCD 相关图片**全部是产品照片**：`cdn.hasselblad.com/f/77891/1000x1000/.../xcd-2035e-listing.jpg`、`xcd-35-100e-listing.jpg`、`xcd-25v-listing.jpg`、`xcd-38v-listing.jpg`、`xcd-55v-listing.jpg`、`xcd-90v-listing.jpg` 等，**无 XCD 徽标文件**。站标仅 `https://www.hasselblad.com/assets/icons/logo-white.svg`（母品牌）。 |
| 2. 官方如何呈现 | **机身铭牌 + 产品图排印**：XCD 作为型号前缀出现在产品照片刻字与网页标题文字中，官方不提供可下载的 XCD 字标。证据页同上（两个 200 页）。 |
| 3. 官方点缀色 | **需用户提供**。`originalColorOverride` 无 hasselblad 条目。 |
| 4. 当前实现 | `official:false, color:null`。`hasselblad-xcd.png` canvas 458x512, ink 441x160, aspect 2.76, padX 6/11, padY 176/176。 |
| 5. 建议动作 | **keep-mono**（官方无彩色 XCD 标识文件）。 |

### 2.6 `fujifilm-xf`

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取（网络阻断）**。`https://fujifilm-x.com/` 返回 **403**，body 为 Cloudflare 挑战页（`<title>Just a moment...</title>`，len=5746）。无法进入 XF 镜头页枚举素材。 |
| 2. 官方如何呈现 | 未能取证。业界通识为**镜身刻字「XF」+ 产品名排印**，但**本次无证据页**，需复核。 |
| 3. 官方点缀色 | **需用户提供**。`originalColorOverride` 无 fujifilm 条目。 |
| 4. 当前实现 | `official:false, color:null`。`fujifilm-xf.png` canvas 315x512, ink 269x154, aspect 1.75, padX 20/26, padY 179/179。 |
| 5. 建议动作 | **keep-mono**（本机不可达，无法取证；XF 标识本身亦为无彩色刻字）。若用户提供官方 XF 铭牌素材 → 改 `ingest-official`。 |

### 2.7 `zeiss-batis`

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取**。`https://www.zeiss.com/camera/en/lenses/batis.html` → **404**（len=236）；`https://www.zeiss.com/camera/en/lenses.html` → **404**；`https://www.zeiss.com/camera/en.html` → **404**。Zeiss 官网可解析的相机/镜头入口为 `https://www.zeiss.com/sunlens` 与 `https://www.zeiss.com/sunlens/en/home.html`（由 `zeiss.com/corporate/en/home.html`，**200**, len=657965 的导航枚举得到）。本次**未在可达路径上定位到 Batis 产品页**（未穷举，属抓取预算所限）。 |
| 2. 官方如何呈现 | 未能取证。业界通识 BATIS 为**镜身刻字 + 镜筒印刷**，**本次无证据页**。 |
| 3. 官方点缀色 | **母品牌蓝可从仓库取到**：`originalColorOverride.zeiss = #102EB3`（v1.1.0 已核验）。**BATIS 标识自身的官方色本次未取到 → 需用户提供**（对照值 Zeiss 蓝 #0F2DB3 不作为答案）。 |
| 4. 当前实现 | `official:false, color:null`。`zeiss-batis.png` canvas 747x512, ink 588x160, aspect 3.67, padX 83/76, padY 176/176。 |
| 5. 建议动作 | **keep-mono**（官方 BATIS 为无彩色刻字；且 Batis 产品页本次未定位到，无法取证彩色版）。 |

### 2.8 `leica-apo`（Leica APO-Summicron）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取**。`https://leica-camera.com/en`（**200**, len=1496944）镜头区链接为 `/en/photography/lenses`、`/en/photography/lenses/m` 等；母品牌 logo `https://leica-camera.com/themes/custom/leica_redesign_theme/logo.svg`（仓库 v1.1.0 已入库，见 `brand-colors.json` `officialAsset.leica`）。本次**未在可达页面上枚举出 APO-Summicron 独立徽标文件**。 |
| 2. 官方如何呈现 | 未能取证。业界通识为**镜身 APO-Summicron 刻字 + 红色 APO 圆环铭牌**，**本次无证据页**。 |
| 3. 官方点缀色 | **母品牌红可从仓库取到**：`originalColorOverride.leica = #E20713`。**APO 标识自身官方色未取到 → 需用户提供**（对照值 Leica 红 #E4002B 不作为答案）。 |
| 4. 当前实现 | `official:false, color:null`。`leica-apo.png` canvas 464x512, ink 324x159, aspect 2.04, padX 64/76, padY 172/181。 |
| 5. 建议动作 | **keep-mono**（Leica APO 红色圆环是镜身实物元素，官网未提供可下载徽标；单色字标 + 母品牌红点缀的近似若要做需用户确认）。 |

---

## 3. 游戏 6 项逐项结论

> **game 组资产说明**：6 项在 manifest 中只有 `slug`/`label`，`official:false`、`color:null`，**无 officialAsset / sourceUrl / accent**；`templates/assets/game/` 下现有 PNG 的 ink 面积很大（如 `wwmeet` ink 1490x303），是**仓库自绘的字标近似**，非官方素材。

### 3.0 官方素材整体可得性（关键发现）

| 渠道 | 结果 |
|---|---|
| **Steam 官方商店页** | ✅ **可用**。`store.steampowered.com/api/storesearch` 与 `/api/appdetails` 均 200（实测），可解析 appid 并拿到 `capsule_image`（官方 capsule 图内含官方字标 lockup）。已验证 **4 项**：zzz / honkai / wukong / wwmeet（+ Arknights: Endfield）。 |
| **HoYoverse 官网**（genshin / zzz / honkai） | ⚠️ 站点可达（200）但**为 Nuxt/JS 壳**，网页上**不发布字标文件**。`hoyoverse.com/_nuxt/*.js` 4 个包（2459/318711/622414/111194 字节）**图片引用数均为 0**；`webstatic.hoyoverse.com/dora/biz/hoyoverse-footer/v1/footer.js`（200, 81485 字节）**图片引用数亦为 0**。 |
| **官方 favicon** | ✅ 可取到，且确为官方图形资源（见各项）。但**分辨率低、非字标**：ZZZ favicon 为 **64x64 PNG**、Honkai3 为 **200x200 PNG**、Arknights 为 **507x431 PNG**。 |
| Arknights 官网 | ⚠️ `arknights.com` **DNS/连接失败**（`Unable to connect`）；`www.arknights.global` 200 但为 2822 字节壳页；其 `index-4cc4fa59.css`（200, 337887 字节）15 个 `url()` **全部是字体**（Oswald/NotoSansCJK/Bender/Novecento），**无 logo 图**；`index-d476d39a.js`（200, 183243 字节）**图片引用数 0**。 |
| wwmeet / wukong 官网 | ❌ `www.heismodegame.com` **DNS 不解析**（`ENOTFOUND`）；`www.wwmeet.cn` **DNS 不解析**。 |
| Genshin | ⚠️ **Steam 无此 app**（`storesearch?term=Genshin Impact` 返回 200 但 `items` 为空，len=22）；`store.epicgames.com/en-US/p/genshin-impact` **403**。官方可达页仅 `genshin.hoyoverse.com/en`（200, 4803 字节壳）/ `/en/news`（200, 11353，图片仅 `upload-static.hoyoverse.com/hk4e/upload/fb/common.jpg`）。 |

### 3.1 `genshin`（原神）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | **未获取**。Steam 无该 app（搜索 API 200 但 `items: []`）；Epic 商店页 **403**；HoYoverse 官网与 Nuxt 包不含任何字标图。**唯一可取的官方图形是 favicon**：`https://genshin.hoyoverse.com/favicon.ico` — 实测 **200**, `image/vnd.microsoft.icon`, **229851 字节**（真 ICO，目录项数 2560 — 多尺寸合集，含 16/32/48/64/96/128/256）。**注意：这是应用图标，不是「原神」中文字标。** |
| 2. 官方如何呈现 | 官网首屏标题为**英文活动语**而非游戏字标：`<title>A Rekviem for the Underworld</title>`，og:image 为 `https://upload-static.hoyoverse.com/hk4e/upload/fb/common.jpg`（200）。证据页 `https://genshin.hoyoverse.com/en`（200, 4803 字节）、`https://genshin.hoyoverse.com/en/news`（200, 11353 字节）。 |
| 3. 官方点缀色 | **需用户提供**。从官方 favicon 采样得到的最饱和不透明像素为 `#F2850E`（ZZZ 同法）… 对 genshin favicon 因含 2560 个混合尺寸条目无法可靠解出单色，**不作答案**。原神官方视觉主色（蓝金）本次**未从官网取到任何 CSS/logo 填充色声明 → 需用户提供**。 |
| 4. 当前实现 | `official:false, color:null`。`templates/assets/game/genshin.png` canvas 1029x512, ink 977x142, aspect 6.88, padX 30/22, padY 187/183。 |
| 5. 建议动作 | **keep-mono + 排印兜底**。官方字标文件**不可得**（Steam 无此 app、Epic 403、官网不发布）；现有 977px 宽 ink 的自绘字标几何良好，**维持单色**。 |

### 3.2 `zzz`（绝区零）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | ✅ **官方可获得（低清）**。Steam appid **4162040**（`storesearch` 200 命中 "Zenless Zone Zero"）。`appdetails` 200（25700 字节）返回：<br>`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4162040/262cc7b613e09b08b4114b2dc13150a75bb31d70/capsule_231x87_alt_assets_1.jpg?t=1788905636`<br>实测 **200**, `image/jpeg`, **11748 字节**, **JPEG 231x87**（aspect 2.65）。<br>`header_image` = `.../285a6967d0efc7e37dad0e6a2d5ec3f0139915fc/header_alt_assets_1.jpg`（460x215）。<br>官方 favicon：`https://zenless.hoyoverse.com/favicon.ico` — **200**, **9721 字节**, **真 PNG 64x64**。<br>商店页 URL：`https://store.steampowered.com/app/4162040/` |
| 2. 官方如何呈现 | 官网为 JS 壳无字标；Steam capsule/header 图内嵌官方字标 lockup（黄黑高对比）。证据页：`https://zenless.hoyoverse.com/en-US/`（200, 8183 字节）。 |
| 3. 官方点缀色 | **需用户提供**。从官方 favicon 采样：最饱和不透明像素 **`#F2850E`**（sat 0.94），但**占不透明像素仅 0.2%**，属**抗锯齿边缘噪声，不可作为品牌色**。**结论：官方色需用户提供。** |
| 4. 当前实现 | `official:false, color:null`。`zzz.png` canvas 470x512, ink 470x162, aspect 2.90, padX 0/0, padY 175/175。 |
| 5. 建议动作 | **ingest-official**（官方 capsule 231x87 确含字标，但**分辨率偏低**，水印/边框需确认；建议同时请用户提供高清单色字标 SVG）。 |

### 3.3 `honkai`（崩坏3）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | ✅ **官方可获得（低清）**。Steam appid **1671200**（storesearch 200 命中 "Honkai Impact 3rd"，商店页标题实测「崩坏3 on Steam」）。`appdetails` 200（18048 字节）返回：<br>`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1671200/capsule_231x87.jpg?t=1787203518`<br>实测 **200**, `image/jpeg`, **14798 字节**, **JPEG 231x87**。<br>官方 favicon：`https://honkaiimpact3.hoyoverse.com/favicon.ico` — **200**, **84021 字节**, **真 PNG 200x200**（本批 game 中分辨率最高的官方图标）。<br>商店页 URL：`https://store.steampowered.com/app/1671200/` |
| 2. 官方如何呈现 | 官网 JS 壳无字标；Steam capsule 图内嵌官方字标。证据页：`https://honkaiimpact3.hoyoverse.com/`（200, 4790 字节）。 |
| 3. 官方点缀色 | **需用户提供**。favicon 采样最饱和像素 **`#FFC62C`**（sat 0.83），**仅占 0.2%** → 抗锯齿噪声，**不作为答案**。 |
| 4. 当前实现 | `official:false, color:null`。`honkai.png` canvas 888x512, ink 838x160, aspect 5.24, padX 25/25, padY 176/176。 |
| 5. 建议动作 | **ingest-official**（Steam capsule 231x87 官方字标；建议请用户提供高清单色 SVG）。 |

### 3.4 `arknights`（明日方舟）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | ⚠️ **部分可得**。Steam 上**未搜到正传**（`storesearch?term=Arknights` 仅命中 `4732690:Arknights: Endfield` 与一个联动包，**无正传 app**）。<br>官方 favicon 可取：`https://www.arknights.global/favicon.ico` — **200**, `image/x-icon`, **5382 字节**, **真 PNG 507x431**（本批 game 中**像素总量最大**的官方图形）。<br>官方 ogp 声明为 `https://webusstatic.yo-star.com/arknights-us/arknights-us-website/main/h5/ogp.png`，实测 **404**（`application/xml`, 421 字节）。<br>官网 JS/CSS 包内**无 logo 图**（见 §3.0）。 |
| 2. 官方如何呈现 | 官网为 Vue SPA，字标以**字体**拼排（CSS `url()` 全部指向 `.../fonts/Oswald-Bold.ttf`、`Novecento-Wide-Bold-2.otf`、`Bender.otf` 等）而非图片。证据页：`https://www.arknights.global/`（200, 2822 字节）与其 CSS `index-4cc4fa59.css`（200, 337887 字节，15 个 `url()` 全为字体）。 |
| 3. 官方点缀色 | **需用户提供**。favicon 为 **索引色 PNG**（color type 3，调色板式），本次未能解出可靠主色。明日方舟官方黄需用户提供。 |
| 4. 当前实现 | `official:false, color:null`。`arknights.png` canvas 1294x512, ink 1035x179, aspect 5.78, padX 129/130, padY 177/156。 |
| 5. 建议动作 | **keep-mono + 排印兜底**（正传 Steam 无官方 capsule；官网不发布字标图；仅 favicon 可用但非字标）。若接受 Endfield capsule 可作风格参考但不应用于正传字标。 |

### 3.5 `wwmeet`（燕云十六声 / Where Winds Meet）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | ✅ **官方可获得（低清）**。Steam appid **3564740**（storesearch 200 命中 "Where Winds Meet"）。`appdetails` 200（32862 字节）返回：<br>`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3564740/7acbd5763280a4baf2a94d164b3fcdad77d9a09e/capsule_231x87.jpg?t=1790514845`<br>实测 **200**, `image/jpeg`, **13183 字节**, **JPEG 231x87**。<br>另有更高分辨率竖版主视觉：`.../640329dbc0083cb8d529340137c80963d87f97e0/header.jpg`（**460x215**, 48028 字节）与 `.../library_600x900_2x.jpg`（**600x900**, 123647 字节）— 二者为**带背景的 KV 图，非纯净字标**。<br>商店页 URL：`https://store.steampowered.com/app/3564740/` |
| 2. 官方如何呈现 | 中文官网域名不可解析（`www.wwmeet.cn` **ENOTFOUND**）；国际版通过 Steam 呈现，capsule/header 内嵌官方中文字标。 |
| 3. 官方点缀色 | **需用户提供**（官网不可达，Steam 图为带背景 KV，取色不具代表性）。 |
| 4. 当前实现 | `official:false, color:null`。`wwmeet.png` canvas 1714x512, ink 1490x303, aspect 4.92, padX 103/121, padY 113/96 — **本组 ink 高度最高（303）且 padY 不对称**，与其余 game 项（padY≈176 对称居中）风格不一致。 |
| 5. 建议动作 | **ingest-official**（Steam capsule 231x87 含官方中文字标；但**建议同时请用户提供高清单色 SVG**，因 231x87 直接用于 6% 照片高的水印会明显偏糊）。 |

### 3.6 `wukong`（黑神话：悟空）

| 项 | 结果 |
|---|---|
| 1. 官方独立徽标文件 | ✅ **官方可获得（低清）**。Steam appid **2358720**（storesearch 200 命中 "Black Myth: Wukong"，商店页标题实测「Black Myth: Wukong on Steam」）。`appdetails` 200（26850 字节）返回：<br>`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2358720/b7f722ddd5e23503f598586aa3700dd4d827bb2d/capsule_231x87.jpg?t=1760601605`<br>实测 **200**, `image/jpeg`, **8660 字节**, **JPEG 231x87**（本组字节最小）。<br>竖版 KV：`.../library_600x900.jpg`（**300x450**, 52678 字节）、`.../header.jpg`（**460x215**, 33808 字节）。<br>商店页 URL：`https://store.steampowered.com/app/2358720/` |
| 2. 官方如何呈现 | 中文官网不可解析（`www.heismodegame.com` **ENOTFOUND**）；国际版通过 Steam 呈现。 |
| 3. 官方点缀色 | **需用户提供**（官网不可达；KV 取色不具代表性）。 |
| 4. 当前实现 | `official:false, color:null`。`wukong.png` canvas 900x512, ink 799x180, aspect 4.44, padX 48/53, padY 176/156。 |
| 5. 建议动作 | **ingest-official**（Steam capsule 231x87 含官方字标；建议请用户提供高清单色 SVG）。 |

### 3.7 game 组「排印兜底」字标建议（官方标识不可得时）

可用字体（`templates/assets/fonts/`，均为 OFL）：

| slug | 推荐字体 | 理由 |
|---|---|---|
| `genshin` | **CormorantGaramond-600** | 原神字标气质为衬线/古典感，Cormorant Garamond 的高对比衬线最接近；次选 `Fraunces-600`。 |
| `arknights` | **Oswald-600** | **关键发现**：Arknights 官网 CSS 实际使用的字体即为 **Oswald-Bold**（`webusstatic.yo-star.com/.../fonts/Oswald-Bold.ttf`，仓库 `templates/assets/fonts/Oswald-400~700.ttf` 同族，OFL）。用 Oswald 排印 = 与官方网页字标**同源**，是最忠实的兜底。 |
| `zzz` | **Unbounded-700** | 绝区零为高对比/几何科技风；Unbounded 的超宽几何笔画最贴近。次选 `BricolageGrotesque-700`。 |
| `honkai` | **BricolageGrotesque-700** | 次选 `InstrumentSans-700`。 |
| `wwmeet` | **CormorantGaramond-600** 或 `MaShanZheng-400` | 中文字标；MaShanZheng 为书法体，适合武侠题材，但与拉丁 `GreatVibes` 相比更「中式」。 |
| `wukong` | **MaShanZheng-400** | 黑神话为国风神话题材，书法体最贴。次选 `LXGWWenKai-700`。 |

通用要求：兜底字标须与现有 ink 几何对齐（game 组 ink 高建议统一到 **160px**，padY 176/176 对称居中），避免出现 `wwmeet` 现有 padY 113/96 的不对称。

---

## 4. 建议动作汇总（18 项）

| # | slug | 组 | 建议动作 | 关键依据 |
|---|---|---|---|---|
| 1 | `sony-gm` | series | **keep-mono** | sony.com 403，本机无法取证 |
| 2 | `sony-g` | series | **keep-mono** | 同上 |
| 3 | `canon-l` | series | **keep-mono** | canon.com.cn 200 但无 L 徽标文件 |
| 4 | `sigma-art` | series | **keep-mono** | ART 为 HTML 文字，非图形 |
| 5 | `sigma-dgdn` | series | **keep-mono** | 同上 |
| 6 | `sigma-apo` | series | **keep-mono** | 同上 |
| 7 | `hasselblad-xcd` | series | **keep-mono** | 仅有产品照片，无徽标文件 |
| 8 | `fujifilm-xf` | series | **keep-mono** | fujifilm-x.com 403 Cloudflare |
| 9 | `zeiss-batis` | series | **keep-mono** | Zeiss 相机镜头路径全 404，未定位到 Batis 页 |
| 10 | `leica-apo` | series | **keep-mono** | leica-camera.com 可达但无 APO 徽标文件 |
| 11 | `tamron-sp` | series | **keep-mono** | sprite.svg 81 symbol 无 SP |
| — | `nikon-s` | series | （已完成） | v1.1.0 已 ingest，accent #FFE100 |
| 12 | `genshin` | game | **keep-mono** | Steam 无 app / Epic 403 / 官网壳页 |
| 13 | `zzz` | game | **ingest-official** | Steam 4162040 capsule 231x87 200 |
| 14 | `honkai` | game | **ingest-official** | Steam 1671200 capsule 231x87 200 |
| 15 | `arknights` | game | **keep-mono** | 正传 Steam 无；官网字标为字体拼排 |
| 16 | `wwmeet` | game | **ingest-official** | Steam 3564740 capsule 231x87 200 |
| 17 | `wukong` | game | **ingest-official** | Steam 2358720 capsule 231x87 200 |

**计数（含 nikon-s 共 18 项）：ingest-official = 4；keep-mono = 14；recolour-with-accent = 0。**
**计数（仅 17 项待补）：ingest-official = 4；keep-mono = 13。**

**recolour-with-accent = 0 的理由**：本次**没有任何一项从官方页面取到可用于套色的点缀色 hex**。Sigma/Tamron/Hasselblad/Canon-L/Zeiss-Batis/Leica-APO 的系列标识在官方站上均为**无彩色**呈现；game 组取到的 favicon 采样色（`#F2850E` / `#FFC62C`）经占比检验仅 0.2%，**属抗锯齿噪声，不可采用**。按「严禁臆造色值」的约束，全部 17 项均不满足套色前提。

> 若用户后续提供官方点缀色，可将 #3 `canon-l`（母品牌红 `originalColorOverride.canon = #C8102E`）、#9 `zeiss-batis`（`#102EB3`）、#10 `leica-apo`（`#E20713`）三项升级为 **recolour-with-accent** — 这三个 hex 已在仓库内经 v1.1.0 核验，属**母品牌色**而非系列标识色，用作系列点缀色需用户确认。

---

## 5. 需要用户提供的素材清单

放置目录：`D:\FrameGeist\brand-official-inbox\`（已 .gitignore）。命名按 slug；建议同时给 SVG 与 PNG。

### 5.1 高优先级 — 可显著提升成图质量（官方 capsule 仅 231x87，用于 6% 照片高水印会偏糊）

| slug | 期望文件名 | 期望格式 | 说明 |
|---|---|---|---|
| `zzz` | `zzz.svg` | SVG（矢量，单色或官方彩色） | 绝区零官方中/英字标 |
| `honkai` | `honkai.svg` | SVG | 崩坏3 官方字标 |
| `wwmeet` | `wwmeet.svg` | SVG | 燕云十六声官方中文字标（**现有 padY 不对称，建议一并提供对齐好的字标**） |
| `wukong` | `wukong.svg` | SVG | 黑神话悟空官方字标 |

### 5.2 镜头系列 — 官方未发布徽标文件，需用户提供高清字标

| slug | 期望文件名 | 期望格式 | 说明 |
|---|---|---|---|
| `sony-gm` | `sony-gm.svg` | SVG 或高分辨率透明 PNG | Sony G Master 官方字标（官网 403，本机不可达） |
| `sony-g` | `sony-g.svg` | SVG 或高分辨率透明 PNG | Sony G 官方字标 |
| `canon-l` | `canon-l.svg` | SVG 或高分辨率透明 PNG | Canon L 系列红色 L 标 |
| `sigma-art` | `sigma-art.svg` | SVG | Sigma ART（官方为文字，可给官方字体版式） |
| `sigma-dgdn` | `sigma-dgdn.svg` | SVG | Sigma DG DN |
| `sigma-apo` | `sigma-apo.svg` | SVG | Sigma APO |
| `hasselblad-xcd` | `hasselblad-xcd.svg` | SVG | Hasselblad XCD |
| `fujifilm-xf` | `fujifilm-xf.svg` | SVG | Fujifilm XF（官网 403 Cloudflare） |
| `zeiss-batis` | `zeiss-batis.svg` | SVG | Zeiss BATIS |
| `leica-apo` | `leica-apo.svg` | SVG | Leica APO-Summicron |
| `tamron-sp` | `tamron-sp.svg` | SVG | Tamron SP |

### 5.3 官方点缀色（仅在用户希望启用 recolour-with-accent 时需要）

| slug | 需要的值 | 用途 |
|---|---|---|
| `canon-l` | L 标官方红 hex | 现仓库仅有母品牌红 `#C8102E`，需确认是否等同 |
| `zeiss-batis` | BATIS 官方色 hex | 仓库仅有母品牌蓝 `#102EB3` |
| `leica-apo` | APO 官方色 hex | 仓库仅有母品牌红 `#E20713` |
| `sony-gm` / `sony-g` | Sony G / G Master 官方色 hex | 仓库**无任何 sony 色值** |
| `sigma-*`、`tamron-sp`、`hasselblad-xcd`、`fujifilm-xf` | — | 官方标识为无彩色，**不需要套色** |
| `genshin`、`arknights` | 官方主色 hex | 若启用彩色版字标 |
| `zzz`、`honkai`、`wwmeet`、`wukong` | — | 若 ingest 官方彩色 SVG 则不需要 accent |

---

## 6. 方法与合规说明

- **抓取手段**：Code Mode `fetch`（与 webfetch 等价），模拟桌面 Chrome UA。全程未使用 websearch。
- **未编造任何 URL**：所有「未获取」均写明原因（403 / 404 / ENOTFOUND / Cloudflare / JS 壳 / 抓取预算）。文中所有 URL 均为**实际请求过**的地址并附实测 status。
- **未臆造色值**：所有 hex 要么来自官方 favicon 实测采样（并标注占比与可信度），要么来自仓库内已核验的 `originalColorOverride`（并标注其为母品牌色而非系列色）。任务书给出的对照色值（Canon #CC0000 / Zeiss #0F2DB3 / Nikon #FFE100 / Leica #E4002B / Sony ~#E4002B）**均未作为答案采用**。
- **只读**：本次仅新建 `docs/reports/v1.2.0/series-game-materials.md`，未修改仓库任何其他文件，未执行 apply，未改动 JSON，未重新生成资产。临时脚本写在仓库外（`%LOCALAPPDATA%\Temp\opencode\`）。
- **已知局限**：
  - sony.com 403、fujifilm-x.com Cloudflare 403、arknights.com 与 wwmeet.cn / heismodegame.com DNS 失败 → 5 项（sony×2、fuji-xf、arknights、wwmeet/wukong 中文官网）**未能取证**，结论按「不可达」而非「不存在」记录。
  - Sigma 分类筛选为客户端 JS 渲染，静态抓取无法枚举筛选态资源。
  - Zeiss 相机镜头页路径全 404，未穷举 Batis 页面（抓取预算所限）。
  - Steam capsule 231x87 为**低分辨率**，直接用于水印质量不足，故 4 项 ingest-official 仍建议同时索取高清单色 SVG。