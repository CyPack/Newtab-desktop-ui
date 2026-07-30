# new-tab-desktop-ui — Cartography Map (odak: responsive ikon yerleşimi)

> Oluşturma: 2026-07-01 · Kaynak: derin kod incelemesi (token-cimriliği yok) · Metodoloji: discovery-first 4 katman
> Amaç: İkon yerleşiminin monitörden monitöre farklı davranması sorununu kökten anlamak + responsive çözüm zemini.

---

## KATMAN 1 — ONTOLOGY (ne bu proje?)

| Boyut | Değer |
|---|---|
| Tür | Tarayıcı uzantısı (Chrome MV3 + Firefox) — "new tab" / desktop speed-dial |
| Fork kaynağı | `lucaseverett/easy-speed-dial` (orijinal CSS-tabanlı responsive grid) |
| Katkı | Cenkay Martin (v3 fork) + @CyPack (= kullanıcı; iki açık PR sahibi) |
| Stack | React 19 · MobX 6 (mobx-react-lite) · Vite 7 · TypeScript 5.9 · webextension-polyfill |
| Sürüm | 3.0.0 (tek tag) |
| State | MobX store (`settings`, `bookmarks`) + `localStorage` (`panel-bookmarks`) + `browser.storage.local` |
| Test | Vitest (yalnız `dialColors` + `mockBookmarks` test'li — Grid/Dial TESTSİZ) |

---

## KATMAN 2 — COMPONENT (parçalar + satır ağırlığı)

```
src/
├── index.tsx (41)                    → app girişi (Bookmarks render)
├── pages/
│   ├── Bookmarks/index.tsx (74)      → <Grid/> + modallar + AlertBanner sarmalayıcı
│   └── Settings/index.tsx (42)       → ayar sayfası (settings.html girişi)
├── components/
│   ├── Grid/index.tsx (1912) ★★★     → TÜM yerleşim mantığı (panel + full-screen + DnD + sync)
│   ├── Grid/styles.css (271) ★★      → .Grid CSS (em-tabanlı responsive sistem — ORİJİNAL)
│   ├── Grid/Dial/index.tsx (806) ★   → tek ikon (favicon fetch + isim + ölçekleme)
│   ├── Grid/Dial/styles.css (187) ★  → ikon boyut/kutu CSS (em-tabanlı)
│   ├── Grid/SettingsGear.tsx (30)    → ayar dişlisi butonu
│   ├── SettingsContent/index.tsx (516) ★ → ayar paneli UI (Dial Size, Max Columns select'leri)
│   ├── SettingsContent/styles.css (253) → ayar paneli CSS (setting-group flex)
│   ├── BookmarkModal/ (526+79)       → bookmark ekle/düzenle modal
│   ├── ContextMenu/ (580+89)         → sağ tık menüsü
│   ├── Modal/ (132+131)              → generic modal
│   └── (About, AlertBanner, ColorPicker, WhatsNewModal, SettingsModal...)
├── stores/
│   ├── useSettings/index.ts (913) ★★ → ayar store + backup/restore + documentElement className autorun
│   ├── useBookmarks/index.ts (348)   → tarayıcı bookmark API sarmalayıcı (MobX)
│   ├── useModals.ts (63) · useContextMenu.ts (40) · useColorPicker.ts (24)
├── lib/  → dialColors.ts (renk üretimi) · imageLuminance.ts · wallpapers.ts
├── utils/ → filter.ts · focus.ts
└── styles/ → global.css · buttons.css · inputs.css · wallpapers.css
```
★ = responsive ikon sorunu için kritik dosyalar.

---

## KATMAN 3 — DEPENDENCY / DATA FLOW (boyut nasıl belirleniyor?)

### Ayar → DOM class zinciri (useSettings/index.ts:842 `autorun`)
`settings.dialSize` (+ maxColumns, squareDials, gridLayout...) → `document.documentElement.className`
Yani `<html class="... tiny unlimited-columns full-screen ...">`. Tüm CSS boyut kuralları bu ata-class'lara dayanır.

### İKİ AYRI VE ÇAKIŞAN BOYUTLANDIRMA SİSTEMİ ⚠️ (sorunun kökü)

**Sistem A — ORİJİNAL (easy-speed-dial), CSS/em-tabanlı, GERÇEKTEN responsive**
- `Grid/styles.css`: `--dial-width: 12.125em` (16px'de 194px). Grid = `repeat(auto-fill, var(--dial-width))`.
- İkon boyutu = ata-class `font-size` ile ölçekleniyor:
  `.extra-tiny→0.3em · .tiny→0.4em · .small→0.5em · .medium→0.6em · .large→0.7em · .huge→0.8em`
- `.scale` = GERÇEK responsive: `font-size: clamp(0.4em, [viewport-genişliği/kolon-formülü], 1.6em)`
  → ekrana göre BÜYÜR, **1.6em (25.6px) tavanı** = zaten var olan "max scale limit".
- `Grid/index.tsx:912` `checkFontSize`: `fontSize === 25.6` → `isMaxFontSize` → `.max-width` class (tavan yakalama).
- Bu sistem SADECE panel layout'larında (`renderPanel` → `.Grid` auto-fill) tam çalışır.

**Sistem B — YENİ (Cenkay v3 fork), JS/piksel-tabanlı, full-screen + panel**
- `Grid/index.tsx:252 calculateGridDimensions()`: `window.innerWidth/Height` + **sabit piksel dialSize**'dan
  cols/rows hesaplar. `renderFullScreenPanel` (satır 1567) inline `grid-template-columns: repeat(cols, 1fr)`
  ile CSS'in `auto-fill, var(--dial-width)` kuralını EZER.
- Panel layout'lar da (`renderGridLayout` satır 1685) inline `1fr` grid + sabit `padding: 60px 80px` kullanır.

### KÖK NEDEN — neden monitörden monitöre farklı davranıyor?

| # | Bug | Kanıt |
|---|-----|-------|
| 1 | **Vocabulary uyumsuzluğu** | JS `calculateGridDimensions` `small/medium/large/extra-large` bekler; CSS/UI ise `extra-tiny/tiny/small/medium/large/huge/scale` kullanır. Kesişmeyen kelime seti. |
| 2 | **Default `dialSize="tiny"` JS'te hiçbir dala uymaz** | (useSettings:203) → JS her zaman `dialSize=60px` fallback → full-screen cols/rows hep 60px'e göre. |
| 3 | **Flat `index` = ekran-bağımlı konum** | `index=15`: 27 kolonlu ekranda kol-15; 10 kolonlu ekranda satır-1 kol-5 → "staircase"/kayma. |
| 4 | **Padding/gap tutarsız** | JS hesap: padding=40, gap=8; render: padding=20px, gap=8px; CSS: gap=1.75em. Üçü farklı. |
| 5 | **`.scale` (asıl responsive mod) full-screen'de devre dışı** | Sistem B inline `1fr` + `repeat(cols)` ile `.scale` clamp'inin dayandığı `auto-fill, --dial-width` yapısını ezer. |

**Sonuç:** İkonlar "ekrana göre akıcı ölçeklenme" yerine "sabit px kutu + değişen sayıda satır/kolon" mantığıyla
yerleşiyor. Farklı monitörde kolon sayısı zıplayınca hem konum (staircase) hem görünüm (küçük kalma / boşluk) bozuluyor.

---

## KATMAN 4 — VERIFICATION (v3.0.0 sonrası PR/commit durumu)

### v3.0.0 sonrası commit'ler (2025-09→2025-12)
Hepsi README / manifest / minor bug (`af2b1bf`, `41aad3e` Dial/index.tsx 2-4 satır). **Yerleşim mimarisi değişmedi.**

### AÇIK PR'LAR (ikisi de @CyPack = kullanıcı, HENÜZ MERGE EDİLMEMİŞ)

**PR #2 — "fix: resolve full-screen grid layout staircase bug" (2026-02-10, +365/-210)**
Bu sorunun ALT-KATMANINI zaten çözüyor:
- Flat `index` → mutlak `(row, col)` koordinat sistemi (masaüstü ikonu gibi sabit konum).
- `calculateGridDimensions` yeniden yazımı: CSS em-tabanlı değerler + 7 dial size'ın hepsi (yukarıdaki 1-4 bug'ları düzeltir).
- `window.resize` → `ResizeObserver` + `requestAnimationFrame` debounce.
- inline gap `8px` → `1.75em` (CSS ile hizalı).
- Legacy `index`→`(row,col)` auto-migration + backup restore'da orijinal kolon sayısı korunuyor.
- Kapsam: SADECE full-screen; 2/3/4-panel dokunulmadı.
- ⚠️ AMA "sınırsız küçülme + max-scale limitli büyüme toggle + side panel örnek ikon" YOK.

**PR #1 — "Add batch favicon prefetching during backup restore" (2025-10-21)** — konu dışı (favicon).

### Kullanıcının İSTEDİĞİ (bu haritanın çözmek istediği hedef) — henüz YOK
1. Tam responsive: bir yerleşim yapıldıktan sonra UI'a göre **sınırsız küçülme** (limitless shrink).
2. Ekrana göre **büyüme** ama **max-scale limitiyle** (65" ekranda dev ikon olmasın).
3. Bir **switch**: max-scale limitleme AÇ/KAPA (limit kaldırılabilir + ölçekli artırılabilir).
4. Side panel'de max-scale ayarlanırken **canlı örnek ikon** göstergesi.

---

## 🎯 ASIL KÖK NEDEN (2026-07-01 derin doğrulama — v3 fork REGRESSION'u)

`git show b0d2080` (2.13.0, fork öncesi) vs mevcut karşılaştırması KANITLADI:

| Öğe | 2.13.0 (fork ÖNCESİ, çalışan responsive) | v3 fork (mevcut/PR#2, bozuk) |
|---|---|---|
| `.Box` (ikon kutusu) | `height: var(--dial-height)` → **em, ölçekleniyor** | `width:48px; height:48px` → **SABİT PİKSEL** |
| `.Grid` base font | `font-size: 18px` | (kaldırılmış → 16px inherit) |
| dialSize em | `.small 0.8em … .huge 1.6em` | `.extra-tiny 0.3em … .huge 0.8em` (minik) |
| `.square .Box` | — | `height: var(--dial-height-attached-title)` (EM! → yarı-migrasyon kanıtı) |

**Teşhis:** v3 fork, "desktop icon" estetiği için dial'ı büyük karttan küçük kare ikona çevirirken `.Box`'ı
**sabit 48px'e sabitledi** ve em kaskadını yarım migrate etti. Sonuç: font-size/`.scale` clamp hâlâ HÜCRE
genişliğini (`--dial-width` em) + metni ölçekliyor **ama ikon kutusu 48px'de donuk**. → "İkonlar ekrana göre
büyümüyor/monitörden monitöre farklı" şikayetinin ASIL nedeni. `.square .Box`'ın em olması = tutarsız yarı-iş.

**Sonuç:** Gerçek responsive için ZORUNLU değişiklik = `.Box`'ı (ve içindeki favicon'u) yeniden **em-tabanlı**
yapmak ki `.scale` clamp (Task 1 ile yapılandırılabilir tavan) tüm ikonu ölçeklesin. Task 1 (clamp bounds)
gerekli ama TEK BAŞINA yetmez — `.Box` em-fix çekirdek. Bu değişiklik GÖRSEL doğrulama ister (chrome-devtools
+ farklı viewport screenshot).

## GLM WORKER DELEGASYONU (bu oturum, orchestrator=Claude)
- Boru hattı: `glm_jobctl.py submit --cwd <repo>` (async, native z.ai anthropic endpoint, concurrency=1). Smoke OK.
- Task 1 (GLM): settings store `limitDialScale`/`maxDialScale` + CSS clamp bounds custom-property. → job glm-20260701-194344.
- Task 2 (GLM): SettingsContent UI (toggle + slider + canlı örnek ikon).
- Çekirdek `.Box` em-fix + görsel doğrulama: ORCHESTRATOR (Claude) — GLM screenshot göremiyor.
- Baseline: 34 önceden-var tsc hatası (dokunma) · `npm run build` YEŞİL (gerçek kapı).

## ✅ UYGULANAN ÇÖZÜM (2026-07-01, feat/responsive-dial-scaling)

**Felsefe (kullanıcı, kesin):** MIN limit YOK · MAX limit VAR. Dial-size seçimi = MAX'ı belirler.
Ekran küçüldükçe ikonlar orantılı küçülür ve HER ZAMAN görünür (asla gizlenmez/kesilmez).

**Commit'ler (PR #2 `f4aef60` üzerine, branch feat/responsive-dial-scaling):**
1. `d7a20de` — Task 1 (GLM): settings `limitDialScale`/`maxDialScale` + CSS `.scale` clamp bounds → custom property.
2. `eb5584a` — Çekirdek (Claude): `.Box` sabit 48px → `calc(var(--dial-width)*0.62)` (em, ölçeklenir) + `.square .Box` kare.
3. `f337752` — Task 2 (GLM): SettingsContent "Maximum Scale Limit" grubu (toggle + slider + canlı örnek ikon) + tip cast fix.
4. `6d39310` — Çekirdek yeniden-mimari (Claude): full-screen **fit-all** sizing.

**fit-all algoritması (`calculateGridDimensions`, full-screen):**
- maxCell = dial-size cap (scale modda: limit açık → maxDialScale×em, kapalı → Infinity).
- upper'dan (cap) AŞAĞI ara: N ikonu viewport'a (W×H) sığdıran EN BÜYÜK cell. Alt sınır yok.
- `renderFullScreenPanel`: sabit `cell px` hücreler + `fontSize=cell/dialWidthValue` (tüm em-kaskadı: box/folder/title/favicon
  cell ile ölçeklenir) + ortalama + taşan bookmark'ları boş hücreye **repack** (eski "gizle" davranışı KALDIRILDI).
- Panel layout'lar (2/3/4) DOKUNULMADI: CSS `.scale` clamp + Task 1 configurable bounds ile çalışır (scroll metaforu).

**Canlı doğrulama (playwright, demo, faithful path):**
| Senaryo | cell | grid | ikon | Sonuç |
|---|---|---|---|---|
| 320×280, tiny | 63px | 4×3 | 11 görünür, 0 kesik | shrink < cap (alt sınır yok) ✓ |
| 500×430, tiny | 77px | 5×3 | 11 görünür | ✓ |
| 1280×800, tiny (cap) | 77px | 14×1 | 11 görünür | büyük ekranda cap'te kalır ✓ |
| 1280×800, scale cap 2.5× | 231px | 4×3 | 11 (box 143px) | cap'e kadar büyür ✓ |
| scale, cap KAPALI | 247px+ | — | — | sınırsız büyür ✓ |

**Settings UI:** dialSize="scale" iken "Maximum Scale Limit" grubu görünür: toggle + slider (1–4×) + canlı "A" örnek ikon
(slider ile 48→90px değişir). Kanıtlandı.

**Baseline:** 34 önceden-var tsc hatası (dokunulmadı, hepsi PR#2 zemininden) · `npm run build` YEŞİL her commit'te.

**Açık ürün kararları (kullanıcıya):**
- Varsayılan `dialSize` hâlâ "tiny" (cap 77px). "Kutudan çıkar çıkmaz büyük+responsive" isteniyorsa default "scale" yapılabilir
  (mevcut kullanıcı görünümünü değiştirir → ayrı karar).
- Settings UI toggle konumu kozmetik ince ayar (başlık üstünde stack) — opsiyonel polish.

## ÇÖZÜM ZEMİNİ (öneri — implementasyon planı ayrı)
- Temel: PR #2'yi merge/rebase temeli yap (koordinat sistemi + em-tabanlı hesap zaten doğru yönde).
- İki sistemi TEK responsive modele indirge: `.scale` clamp'ini full-screen'e de uygula (CSS custom property ile min/max dial genişliği).
- `--dial-min` (sınırsız küçülme) + `--dial-max` (toggle'lı tavan) CSS değişkenleri; JS `calculateGridDimensions` bunları okusun.
- SettingsContent: yeni "Responsive Scale" grubu → toggle + slider (max limit) + canlı `<Dial>` önizleme.
- settings store: `scaleMode` ("fit"|"fixed"), `maxScalePx`/`maxScaleEm` alanları + `handle*` + backup/restore + autorun class.

*Bağımlı kurallar: discovery-first (bu harita), evidence-propagation (her iddia koda dayalı), state-comparison-reporting.*

---

## 🔁 MİMARİ DEĞİŞİKLİK (2026-07-30) — fit-all → SABİT TUVAL + TRANSFORM ZOOM

**Kullanıcının asıl gereksinimi (netleştirildi):** ikon BOYUTU önemsiz; önemli olan **yerleşim
pozisyonlarının değişmemesi**. "Telefon ekranına küçülttüğümde o alanı karınca kadar da olsa orda
yine aynı app ikonlarını birbirlerinden aynı mesafede ve aynı alt/üst/sağ/sol pozisyonlanmasında
görmek istiyorum."

### Neden "fit-all" (6d39310) yanlıştı
`calculateGridDimensions` her resize'da `cols`'u viewport genişliğinden YENİDEN hesaplıyordu
(`cols = floor((availW + gap) / (cell + gap))`). Kolon sayısı değişince grid akıyor (reflow);
`(row,col)` koordinatları korunsa bile ikonların ekrandaki yeri kayıyordu. Yani fit-all,
istenen şeyin tam tersini yapıyordu.

### Yeni model
```
SABİT MANTIKSAL TUVAL (settings.gridCols x settings.gridRows, storage'da kalıcı)
   ↓ bir kere, sabit logical cell (= --dial-width @16px) ile layout
   ↓ transform: scale(s)  ·  s = min(availW/logicalW, availH/logicalH, cap/logicalCell)
GÖRÜNEN GRID  — cols/rows ASLA değişmez, sadece zoom değişir
```
- Aspect ratio korunur (letterbox); artan yer eşit kenar boşluğu olur.
- MIN yok, MAX var (dial-size / max-scale slider) — eski felsefe korundu.
- Tek `transform` olduğu için sabit-px CSS detayları (border-radius 12px, title
  `padding-inline: 8px`, `clamp(10px, .8125em, 15px)`) da ölçekleniyor — px hesabı
  yaklaşımında bunlar donuk kalıyordu.
- Tuval yalnız İKİ şeyle değişir: (1) kullanıcı Settings > Desktop Grid'den değiştirir,
  (2) sınır dışına düşen bir bookmark varsa tuval BÜYÜR (ikon taşınmaz — konum kutsal).

### Dosyalar
- `src/components/Grid/layout.ts` **(YENİ)** — saf matematik: `fitScale`, `logicalCellSize`,
  `maxCellSize`, `captureCanvas`, `occupiedExtent`, `canvasPixelSize`. DOM/store bağımlılığı yok.
- `src/components/Grid/layout.test.ts` **(YENİ)** — 12 test; invaryantı çalıştırılabilir hale getirir.
- `src/components/Grid/index.tsx` — `gridDimensions` state → `canvas` (settings'ten memo, resize'dan
  bağımsız) + `scale` state. `calculateGridDimensions` (O(cap) lineer arama) silindi.
  `isMaxFontSize`'ın sabit-kodlu `25.6` karşılaştırması `maxDialScale`'e bağlandı.
- `src/stores/useSettings/index.ts` — `gridCols`/`gridRows` + `handleGridCanvas` + backup/restore/reset.
- `src/components/SettingsContent/` — "Desktop Grid" grubu (cols x rows + oranlı önizleme + auto-fit reset).

### Doğrulama (2026-07-30)
- `npx vitest run` → **45/45 PASS** (12'si yeni layout invaryant testi)
- `npm run build` → YEŞİL · `npx tsc -b` → **34 hata** (baseline ile AYNI, regresyon yok)
- Canlı playwright probu (tek yükleme + sadece resize, reload YOK):

| viewport | cols×rows | slot | cell | aspect | slot konum sapması |
|---|---|---|---|---|---|
| 1920×1080 | 21×11 | 231 | 77.60px | 1.9193536 | 0 |
| 1366×768 | 21×11 | 231 | 55.71px | 1.9193537 | 1.16e-7 |
| 1024×768 | 21×11 | 231 | 41.34px | 1.9193537 | 1.43e-7 |
| 800×600 | 21×11 | 231 | 31.93px | 1.9193537 | 1.24e-7 |
| 412×915 | 21×11 | 231 | 15.63px | 1.9193531 | 3.10e-7 |
| 320×480 | 21×11 | 231 | 11.76px | 1.9193538 | 2.18e-7 |

İkon-içi geometri sapması ≤ 1.33e-6 → ikon içeriği de orantılı ölçekleniyor. Konsol hatası yok.
**VERDICT: PASS** — sapma float hassasiyeti seviyesinde (0.0001px altı).

> ⚠️ Prob yazarken tuzak: `Dial` kendi kökünde de `data-id` basıyor → her bookmark için İKİ element.
> `data-id` ile eşleştirme sahte sapma üretir; slot `(row,col)` ile anahtarla.

### Ek düzeltme — ÇIPA = SOL ÜST (2026-07-30, kullanıcı geri bildirimi)
Tuval ortalanmıştı (`justify/alignItems: center` + `transform-origin: center center`) → ekran
küçüldükçe düzen içe doğru toplanıyordu; göreli konumlar korunsa da bu "kayma" olarak okunuyordu.
**Tek sabit referans köşesi = SOL ÜST.** `flex-start` + `transform-origin: top left`.
Kenar boşluğu sabit 20px bırakıldı (ölçeklenseydi 4K'da devasa, telefonda ~3px olurdu → çıpa tutarsız).
Ölçüm: çıpa **(20, 20)** — 1920×1080'den 320×480'e kadar DEĞİŞMİYOR.

Ayrıca: `.Bookmarks` içinde AlertBanner + `height:100vh` grid = toplam 100vh'yi aşıyordu →
banner açıkken tuvalin alt satırı ekranın altında kalıyordu. `:has(.FullScreenViewport)` ile
scope'lanmış flex-fill düzeltmesi (panel layout'lara DOKUNMAZ).

> 🐞 **Ayrı, önceden var olan bug (düzeltilmedi):** `SettingsGear` (`position:fixed; top:20; right:20;
> z-index:1000`, kutu 1880-1896 × 24-40) AlertBanner'ın dismiss butonunun (1870-1900 × 14-44)
> TAM MERKEZİNE biniyor → banner'ı kapatmak için tam ortaya değil biraz SOLA tıklamak gerekiyor.
> Otomasyonda `click({position:{x:5,y:15}})` şart; `force:true` işe yaramaz (event dişliye gider).

---

## 📄 SAYFA MODELİ (2026-07-30, kullanıcı gereksinimi)

**Kullanıcı kuralları (aynen):**
1. 34"/57" monitörlerde sağa/sola ekstra **stage** eklenmeli.
2. Büyükten küçüğe geçerken boş kolon/satırlar **1 boşluk kalana kadar kırpılarak** ilerlenmeli.
3. Tamamen boş kolon/row kalmadıysa o frame kabul edilip ekrana göre ayarlanır.
4. **24" alan base default** olarak hesaplanır; sağa/aşağı taşan her alan bir **ekstra page**.
   Geniş ekranda tek page gibi davranır; çok büyük ekranlarda page hesabıyla hareket edilir.

**Model:**
```
BASE PAGE = referans ekranın (settings.basePageWidth×Height, varsayılan 1920×1080 = 24")
            cap hücre boyutunda tuttuğu C×R hücre
≥ 1 sayfa  → mode="pages"  : pagesX=round(availW/pageW), pagesY=round(availH/pageH)
                             cols=pageCols*pagesX (TAM sayfa), hücre cap'te, kırpma YOK
< 1 sayfa  → mode="cropped": cols=clamp(fitCount(availW,ref), content+1, pageCols)
                             önce boş kenar kırpılır, SONRA zoom
her ikisinde → minCellSize tabanı; altına inmesi gerekirse zoom durur, masa KAYDIRILIR
```
İçerik bloğu (ikonların bounding box'ı) KATI — hiçbir rejimde yeniden dizilmez.

**Koordinat uzayları (kritik):** `stored` (kalıcı, ≥0) ↔ `rendered` = stored + plan.offset.
Tüm DnD/modal handler'ları `toStored()` ile geri çevirir; kaydedilen veri pencereye BAĞLI DEĞİL.
Sol/üst sayfaya bırakma negatif üretir → `normalizeFullScreenCoords` tek noktadan re-base eder
(hepsi aynı miktarda kayar → göreli konum korunur).

**Çıpa:** `settings.deskAnchor` = `center` (varsayılan) | `top-left`.
center → içerik bloğu her ekranda ortada · top-left → sol üst köşeye çakılı. İkisi de SABİT ilişki.

**Render ağacı (transform + scroll için ZORUNLU 3 katman):**
```
.FullScreenViewport  (flex, anchor hizası, overflow: plan.overflow ? auto : hidden)
  └ .FullScreenDesk  (SPACER — logical*scale boyutunda; transform layout boyutunu DEĞİŞTİRMEZ,
                      bu olmadan ortalama ve kaydırma ölçeklenmemiş boyuta göre yanlış çalışır)
      └ .Grid        (logical boyut + transform: scale, transform-origin: top left)
```

**Canlı ölçüm (2026-07-30, tek yükleme + sadece resize):**

| ekran | cols×rows | sayfa | hücre | scroll |
|---|---|---|---|---|
| 57" 5120×2160 | 63×22 | 3.00 | 70.87 | hidden |
| 34" 3440×1440 | 42×11 | 2.00 | 71.22 | hidden |
| 27" 2560×1440 | 21×11 | 1.00 | 77.60 | hidden |
| **24" 1920×1080 BASE** | **21×11** | **1.00** | **77.60** | hidden |
| laptop 1366×768 | 15×8 | 0.71 | **77.60** (kırpıldı, ikon küçülmedi) | hidden |
| 1024×700 | 11×7 | 0.52 | **77.60** (kırpıldı) | hidden |
| 800×600 | 11×6 | 0.52 | 61.29 (kırpma bitti → zoom) | hidden |
| 412×915 | 11×10 | 0.52 | **32.00** (taban) | **auto** |
| 320×480 | 11×5 | 0.52 | **32.00** (taban) | **auto** |

Göreli ikon dizilimi 9 ekranın hepsinde BİREBİR aynı · büyük ekranlar tam sayı sayfa · konsol hatası yok.
Testler: `layout.test.ts` 27 test (60/60 toplam) · `npm run build` yeşil · `tsc` 34 = baseline.

### Düzeltme — MİNİMUM HÜCRE KALDIRILDI (2026-07-30, kullanıcı)
"min icon size olmasın, icon size'ları küçülebilir, telefon ekranında da aynı koordinasyonları
görebilmeliyim." → `minCellSize` ayarı + `CanvasPlan.overflow` + scroll yolu tamamen SİLİNDİ.
Masa her zaman sığacak kadar zoom out eder; `overflow: hidden` sabit. Base 24" ve oradaki
yerleşim (21×11 @ 77.6px) DEĞİŞMEDİ.

**Canlı ölçüm (12 ekran, tek yükleme + sadece resize):**

| ekran | cols×rows | sayfa | hücre | scroll | dizilim |
|---|---|---|---|---|---|
| 57" 5120×2160 | 63×22 | 3.00 | 70.87 | no | same |
| 34" 3440×1440 | 42×11 | 2.00 | 71.22 | no | same |
| 27" 2560×1440 | 21×11 | 1.00 | 77.60 | no | same |
| **24" 1920×1080 BASE** | **21×11** | **1.00** | **77.60** | no | same |
| MacBook Air 1440×900 | 15×9 | 0.71 | 77.60 | no | same |
| laptop 1366×768 | 15×8 | 0.71 | 77.60 | no | same |
| MacBook 13 1280×800 | 14×8 | 0.67 | 77.60 | no | same |
| 1024×700 | 11×7 | 0.52 | 77.60 | no | same |
| 800×600 | 11×6 | 0.52 | 61.29 | no | same |
| telefon 412×915 | 11×10 | 0.52 | 30.00 | no | same |
| telefon 390×844 | 11×9 | 0.52 | 28.23 | no | same |
| 320×480 | 11×5 | 0.52 | **22.58** | no | same |

Hiçbir ekranda kaydırma/kırpma yok · dizilim 12/12 birebir aynı · konsol hatası yok.

### Demo verisi — TETRIS DESENİ (2026-07-30, kullanıcı: "farklı köşelere, tetris gibi")
`mockBookmarks` 11 → **24 uygulama** (13 yeni; thumbnail YOK → `Dial` renkli kutu + baş harf
fallback'i, `Dial/index.tsx:640`). `mockBookmarks/demoLayout.ts` **(YENİ)** başlangıç desenini verir:

```
sol üst   O bloğu (0,0)(0,1)(1,0)(1,1)      sağ üst  L bloğu (0,19)(1,19)(2,19)(2,20)
sol alt   T bloğu (9,1)(10,0)(10,1)(10,2)   sağ alt  S bloğu (9,19)(9,20)(10,18)(10,19)
orta      I çubuğu (4,10)(5,10)(6,10)(7,10) tekler   (2,5)(7,4)(3,15)(8,14)
```
Amaç: düz bir sıra layout hatalarını GİZLER (herhangi bir kural tek satırı makul gösterir).
Asimetrik desen, kolon reflow / yanlış kenar kırpma / tutarsız offset'i anında görünür kılar.

⚠️ Desen dışı öğeler (dev-only "Top Sites" klasörleri) **deterministik boş hücreye** atanır
(tarama (5,2)'den başlar). Atanmazsa aynı hücreye düşüp renderer'ın son-çare yerleştirmesine
giderler — o da masa boyutuna bağlı olduğu için **desen ekrandan ekrana DEĞİŞİR** (yaşandı).

### İki bug daha (bu sırada bulundu ve düzeltildi)
1. **İlk yerleşim çöpe gidiyordu:** `savedPanelBookmarks.length === 0` dalında hesaplanan
   `organized` state'e yazılıyor ama altındaki senkron bloğu hâlâ ESKİ (boş) diziyi kullanıyordu
   → her bookmark "yeni" sayılıp sıralı yeniden yerleştiriliyordu. `savedPanelBookmarks = organized`
   eklendi. (Yan etki: dev-only klasörler artık düzgün kalıcı → demo 24 değil 26 tile.)
2. **"+1 boş kenar" kuralı sayfayı taşırıyordu:** içerik sayfayı tam doldurduğunda
   `content+1` masa boyutunu page'in üstüne çıkarıyordu (21×11 sayfa → 22×12 masa).
   Kullanıcının 3. kuralı geçerli: boş kolon/row yoksa frame olduğu gibi kabul edilir.
   `min(content+1, page)` ile düzeltildi; içerik sayfadan büyükse masa yine içeriği kapsar.

**Tetris deseniyle canlı ölçüm (12 ekran):** 57"→3 sayfa(63×22, 70.9px) · 34"→2(42×11, 71.2px) ·
27"/24"→1(21×11, 77.6px) · MBA1440→21×11@58.8 · 1366→55.7 · 1280→52.1 · 1024→41.3 · 800→31.9 ·
412→15.6 · 390→14.7 · 320→**11.8px**. Dizilim 12/12 birebir aynı · scroll/kırpma yok · konsol temiz.
62 test PASS · build yeşil · tsc 34 = baseline.

---

## 🖱️ İKON TAŞIMA — PRODUCTION-GRADE UX (2026-07-30)

**Şikâyet:** "ikonu sol üst köşedeki boşluğa direkt taşıyamadım, adım adım taşıdım; her taşıdığımda
diğerleri bir uzaklaştı ve küçüldü gibi geldi."

### Kök neden 1 (asıl) — merkezleme CANLI içerik kutusundan türetiliyordu
`offsetX = floor((desk.cols − content.cols) / 2)`. İçerik 3 kolon, masa 16 → offsetX=6.
Bir ikonu 2 hücre sağa taşı → içerik 5 kolon → offsetX=5 → **TÜM ikonlar 1 hücre sola kayar.**
Testle kanıtlandı (6 → 5). Demo'da görünmüyordu çünkü tetris deseni sayfayı tam dolduruyor,
bbox sabit kalıyor; **derli toplu bir blokta** ise her taşımada tetikleniyor.

→ **ÇÖZÜM: offset TAMAMEN KALDIRILDI.** Kayıtlı hücre = masadaki hücre. Merkezleme artık
masanın pencere içindeki hizasıyla (`deskAnchor`, saf CSS) yapılıyor — hiçbir ikon etkileyemez.
`CanvasPlan.offsetX/offsetY` ve `toStored()` yok. `content` artık sadece **kapsama tabanı**
(`maxCol+1`), shrink-wrap değil.

### Kök neden 2 — hücreler arası boşluk hiçbir drop hedefine ait değildi
Gap'e bırakma slot handler'larını ıskalıyor, `.FullScreenViewport`'a baloncuklanıp
`handleDropOnPanelEnd` → `findEmptySlot` ile ikonu **ilk boş hücreye ışınlıyordu**.
→ **ÇÖZÜM:** tek masa-seviyesi `dragover`/`drop`; hedef hücre **işaretçi koordinatından**
hesaplanıyor (`cellUnderPointer`, transform ölçeği hesaba katılır), kenar dışı **kenetlenir**.
Masanın her pikseli geçerli ve öngörülebilir hedef. Slot başına handler + `stopPropagation` kalktı.

### Kök neden 3 — kırpma düzenleme sırasında masayı nefes aldırıyordu
Kırpma tasarım gereği içeriğe bağlı; her taşımada masa büyüyüp küçülüyordu.
→ **ÇÖZÜM: sticky sizing.** Masa yalnız **pencere** değişince yeniden kırpılır
(`lastViewportRef`); aynı pencerede asla küçülmez, sadece kapsama için büyür.

### Ayrıca temizlendi
- `addFolderHoverListeners`/`cleanupFolderListeners`/`isInDragZone` **SİLİNDİ**: drag başında
  her ikona 2 dinleyici bağlıyor, her `dragover`'da `[draggable="true"]:hover` dahil 2 document
  sorgusu koşuyordu (ikon sayısıyla ağırlaşan jank) — üstelik hiç üretilmeyen `.sortable-chosen`
  sınıfına bakıyordu, yani klasör vurgusu **hiç çalışmıyordu**.
- `* { user-select: none }` global reset → `.FullScreenViewport, .Grid` ile scope'landı
  (ayar paneli ve modallarda metin seçimini de kapatıyordu).

### Canlı drop göstergesi (üç sonuç ayrı okunur)
| Nereye | Niyet | Görsel |
|---|---|---|
| boş hücre | `move` | beyaz ince çerçeve (sakin — hiçbir şey yerinden olmuyor) |
| dolu hücre | `swap` | **amber** çerçeve+dolgu (başka bir ikon da hareket edecek) |
| klasörün **ortası** (%60) | `folder` | **yeşil** + klasör %8 büyür (kap açılıyor) |
| klasörün **kenarı** | `swap` | amber — klasörle yer değiştir |
Sürüklenen ikon `opacity .35` ile soluklaşır (göz sürükleme görüntüsünü takip etsin).

### Doğrulama (canlı, sentetik DragEvent + gerçek dragTo)
- gösterge 7/7 doğru hücreyi işaretledi (merkez · gap · köşe · uzak · kenar-dışı kenetleme) ·
  `dragend` sonrası temizleniyor
- niyet ayrımı 4/4 semantik doğru (boş=move · dolu=swap · klasör-ortası=folder · klasör-kenarı=swap)
- **tek uzun sürükleme** uzak boş hücreye: doğru hücre, **diğer 23 ikon 0 hareket**
- **gap'e bırakma**: en yakın hücreye indi (ışınlanma YOK), diğerleri 0 hareket
- **4 ardışık sürükleme**: her adımda doğru hücre, hücre boyutu 77.6px sabit, diğerleri 0 hareket
- **swap** uçtan uca: A↔B yer değiştirdi, diğer 24 ikon 0 hareket
- sayfa/ölçek garantileri korundu: 12 ekranda dizilim aynı, scroll yok
- 63 test PASS · build yeşil · tsc **34 = baseline**

---

## 🧭 BÖLGE GENİŞLETME (territory expansion) — 2026-07-30

**Şikâyet:** "sabit varsayılan box'lar 24 inch'e optimize; ekranı değişik şekillere sokunca
ÖLÜ / kullanışsız bölgeler oluşuyor. Ölü bölgelerde bile grid olacak ve ölçekleme EN DIŞ
KÖŞEDEKİ İKONA göre referans alınacak." + "oyunlardaki alan genişletme gibi düşün."

### İki şey AYRIŞTIRILDI (kritik)
```
GRID  → PENCEREYİ DOLDURUR. Ekran hangi şekildeyse (dikey monitör, 57" ultrawide,
        esnetilmiş panel) hücreler kenardan kenara. Bırakılamayan bölge YOK.
ÖLÇEK → yalnız AKTİF ALANDAN gelir = ikonların erişim kutusu (maxCol+1 × maxRow+1).
        Ötesindeki boş grid BEDAVA — köşedeki 3 ikon 57"'te de tam boyutta kalır.
```
Boş grid'e ikon koy → kutu ona ulaşacak kadar büyür → **aradaki alan aktifleşir** ve masa
yeniden ölçeklenir. Dial-size hâlâ TAVAN, taban YOK.

### Yüksek-su işareti + serbest bırakma
- Aktif alan oturum içinde **yalnız BÜYÜR** (`activeAreaRef`) → ikonu geri alınca düzenleme
  ortasında her şey birden büyümez.
- **Yeniden yüklemede** `loadPanelBookmarks` koordinatları başlangıca **re-base eder**
  (`normalizeFullScreenCoords`) → ulaşılmayan alan tekrar ölü olur. Kullanıcının C kuralı.
- ⚠️ Re-base HER MUTASYONDA yapılamaz: en üstteki ikonu aşağı taşıyınca tüm dizilim yukarı
  fırlar. Mutasyonda yalnız **negatif koordinat** güvenlik ağı çalışır.

### Neden `active` == `reach` (tek girdi)
Ölçeği sınır kutusundan alıp grid'i mutlak (0,0)'dan çizmek, ikonlar soldan/üstten boşluk
bırakınca kutu ile erişimi ayrıştırıyordu → grid taşıyor, köşe ikonu **ekran dışında** kalıyordu
(canlı probda yakalandı). Yüklemede re-base sayesinde kutu = erişim; belirsizlik yok.

### ⛔ EMEKLİ: tam-sayfa yuvarlaması
`pagesX = round(availW/pageW)` ya sağda ölü şerit bırakıyor ya zorla zoom-out ettiriyordu —
"ölü bölge olmasın" kuralıyla doğrudan çelişiyor. `cols = fitCount(availW, cell)` ile değişti.
`basePageWidth/Height` yalnız **boş masanın varsayılan aktif alanı** olarak kaldı (24" → 21×11).

### Ayrıca düzeltildi
**Sürükleme sırasında plan dondurma KALDIRILDI.** `dragend` gelmezse (iptal, pencere dışı bırakma)
bayrak takılı kalıyor ve plan KALICI donuyordu — canlı probda yakalandı: pencere 2560→600'e
küçültülmesine rağmen hücre 77.6px'te kalıp masa ekran dışına taştı. Yeni modelde dondurma zaten
gereksiz (aktif alan yalnız bırakma anında değişir).

### Canlı doğrulama
**A · ölü bölge** — 8 ekran şekli, kapsanmayan alan en kötü **0.95 hücre** (bir hücreden az):
57" 57×24 · 34" 38×15 · 24" 21×11 · dikey 11×21 · dar panel 10×27 · geniş şerit 26×5 ·
kare 10×10 · telefon 10×22. Grid her şekilde ekranı dolduruyor.

**B+C · bölge genişletme döngüsü**

| adım | grid | hücre | erişim | |
|---|---|---|---|---|
| başlangıç 2560×1440 | 28×15 | 77.6px | 2,9 | |
| köşeyi al | 28×15 | 77.6px | **14,27** | bölge iddia edildi |
| 1024×768'e geç | 28×20 | **30.96px** | 14,27 | köşe görünür kalsın diye küçüldü |
| ikonu geri getir | 28×20 | **30.96px** | 2,9 | aynı oturum → tutuldu, sıçrama yok |
| **yeniden yükle** | **11×8** | **77.6px** | 2,9 | **ALAN SERBEST** |

58 test PASS · build yeşil · tsc **34 = baseline** · konsol hatası yok.

### Drop geri bildirimi ölçekten bağımsız (f4161e3)
Masa `transform: scale(~0.32)` ile çizildiği için 2px'lik drop çerçevesi ekranda **0.6px**'e
düşüyordu — büyük ekranda pratikte görünmez. Çizgi kalınlıkları ve yarıçaplar artık zoom'a
bölünüyor (`--desk-scale` custom property + `calc(2.5px / var(--desk-scale))`), ekranda sabit
2.5px. `--desk-scale` aynı zamanda **hangi build'in çalıştığını** anlamanın en hızlı yolu:
```js
getComputedStyle(document.querySelector('[data-panel="full-screen-panel"]'))
  .getPropertyValue('--desk-scale') ? 'YENİ' : 'ESKİ'
```

### Canlı doğrulama — görünür pencerede, gerçek fare (2026-07-30)
`~/projects/click-bridge/tools/dev-browser.sh http://localhost:5173` (CDP :9222) →
playwright `connectOverCDP`. Sonuç: masa 1780×555 / pencere 1824×595 (ekranı dolduruyor) ·
grid 35×11 · hücre 45px · sol-üstten (0,0) sağ-alt uca (10,34) **tek hamlede** sürükleme,
gösterge yol boyunca takip etti, bırakma hedefe indi, konsol temiz.

> ⚠️ **Playwright ile native drag:** `mouse.down()` sonrası ÖNCE küçük bir dürtme
> (`mouse.move(x+12, y+12)`) şart — doğrudan hedefe atlarsan `dragstart` HİÇ tetiklenmez ve
> gösterge "hiç çıkmıyor" sanılır. Ayrıca sürükleme ortasında `page.screenshot()` almak
> native drag'i kesiyor (gösterge donmuş görünür). İkisi de teşhiste yanlış iz sürdürdü.

---

## Kalıcılık ve yedek katmanı (2026-07-30)

Buraya kadarki her şey **yerleşimin nasıl çizildiğiyle** ilgiliydi. Bu bölüm **nasıl saklandığıyla**
ilgili. Yerleşim mimarisi oturduktan sonra ortaya çıkan soru şuydu: pozisyonlar kaydediliyor mu,
ve kaybolursa geri gelir mi? Birincinin cevabı baştan beri evetti; ikincininki **hayırdı**.

### Devralınan durum — ne vardı, ne yoktu

| vardı | yer |
|---|---|
| `(row,col)` → localStorage `panel-bookmarks` | `Grid/index.tsx` `savePanelBookmarks` |
| 300 ms debounce + **yazma doğrulaması** (geri okuyup karşılaştırma) | `debouncedSavePanelBookmarks` |
| Kota hatasında sessionStorage'a düşme | `savePanelBookmarks` catch |
| Yüklemede origin'e re-base | `loadPanelBookmarks` |

Yani **pozisyon kayıt sistemi vardı ve çalışıyordu.** Altındaki ağ yoktu.

### Beş kusur — hepsi koddan kanıtlandı

| # | kusur | neden ölümcül |
|---|---|---|
| B1 | 24 saatlik yedek `setInterval`'ı **hiç ateşlenemez**: effect bağımlılığı `[isRootSafe, panelBookmarks]`, her sürükleme sayacı sıfırlıyor | tek "yedek" mekanizması ölü kod |
| B2 | Yazdığı `panel-bookmarks_backup_<tarih>` anahtarlarını **okuyan kod yok**, budayan da yok | sadece kota tüketiyor; geri dönüş yolu yok |
| B3 | `loadPanelBookmarks` parse hatasında **tek kopyayı siliyordu** (`removeItem`) | parse hatası → kalıcı veri kaybı |
| B4 | Yedeğe yazılan `gridDimensions` **canlı DOM'dan** ölçülüyordu | yedek, alındığı monitöre bağımlı → I8 ihlali |
| B5 | Geri yükleme filtresi `typeof index === 'number'` **ve** `type` alanı şart koşuyordu | koordinat-taşıyan girdiler **sessizce** düşüyordu |

### Kurulan model

```
panel-bookmarks            → TEK GERÇEK. Değişmedi, değiştirilmedi.
panel-bookmarks-history    → sınırlı halka tampon (10 snapshot / 512 KB)
panel-bookmarks-corrupt    → karantina: okunamayan yük SİLİNMEZ, kenara alınır
```

`positionStore.ts` — üç kural üzerine kurulu:

1. **BEST EFFORT.** Snapshot, asıl kayıt **başarılı olduktan sonra** alınır ve içindeki her hata
   yutulur. Snapshot kaybetmek can sıkıcıdır; snapshot yüzünden kaydı kaybetmek, önlemeye
   çalıştığı bug'ın ta kendisidir.
2. **SINIRLI.** Hem adet hem serileşmiş bayt cinsinden. Kota dolarsa en eskiden başlayarak döker,
   pes etmez. Eski tarihli anahtarların sınırsız büyümesi tekrarlanmaz.
3. **KARANTİNA, SİLME DEĞİL.** Bozuk yük incelenebilsin diye saklanır; yerini en yeni snapshot alır.

**Snapshot ne zaman alınır:** kaydın kendisine bağlı (`savePanelBookmarks` içinde), tek bir
çağıranın içinde değil — böylece gelecekteki hiçbir yazma yolu unutamaz. Rutin değişiklikler
5 dakikalık pencerede kısılır; **sayfa gizlenince** (`visibilitychange` + `pagehide`) kısıtsız
bir snapshot zorlanır. Ölü 24 saatlik interval'in yerini bu aldı: new-tab sayfası günlerce değil
saniyelerce açık kalır, önemli olan an sayfanın **gitmesidir**.

> **Geri yüklemede de snapshot:** yanlış dosyayı restore etmek artık tek yönlü kapı değil —
> `restoreFromJSON` üzerine yazmadan önce mevcut dizilimi `before-restore` etiketiyle kaydeder.

### Ölçümde çıkan gerçek kusur — kurtarılan veri geri yazılmıyordu

Prob C0 "(9,9) snapshot'ta" derken C2 "(0,0) geri geldi" diyordu. Prob artefaktı sanıldı, değildi:
`loadPanelBookmarks` **başlangıçta birden fazla kez** çağrılıyor. İlk çağrı karantina yapıp
anahtarı siliyor ve snapshot'tan kurtarıyordu — ama kurtardığını **geri yazmıyordu**. İkinci çağrı
boş anahtarı görüp masayı sıfırdan kuruyor ve kurtarmayı sessizce geri alıyordu.
Düzeltme: kurtarılan dizilim döndürülmeden önce `panel-bookmarks`'a yazılır.

> **Ders:** "kurtardım" demek yetmiyor — kurtarmanın **kalıcı ve idempotent** olması gerekiyor.
> Tek okuyucu varsayımı, birden fazla okuyucusu olan bir başlangıç akışında sessiz veri kaybı üretir.

### Doğrulama

`probes-newtab-desktop-ui/nt-backup.mjs` — gerçek sayfada 8 kontrol:
A1 eski anahtarlar emekli · A2 en yenisi geçmişe devralındı · B1 pencere içi değişiklik kısılıyor ·
B2 sayfa gizlenince zorlanıyor · C0 işaret geçmişe ulaştı · C1 karantina · C2 **işaretli pozisyon
bozulmayı atlattı** · D1 geçmiş sınırlı.

```
8/8 checks passed
78 test PASS (58 → +20) · build yeşil · tsc 34 = baseline
I1 dizilim sabitliği PASS · I2 sürükleme izolasyonu 0/23 · I6 serbest bırakma PASS
```

> ⚠️ **`ntdui-page-probe.mjs` içindeki "whole-page rounding" kriteri EMEKLİ** — puanlanmıyor,
> yalnız raporlanıyor. Sayfa yuvarlaması bilerek terk edildi (aşağı yuvarlama ölü bölge
> bırakıyordu). Bu satırın `false` olması **doğru davranıştır**; verdict'i düşürmemeli.

---

## Masa yakınlaştırma + emekli sayfa modelinin kalıntıları (2026-07-30, ikinci tur)

Üç soru soruldu, üçü de farklı cevap verdi. Sırayla ve **ölçerek**.

### 1. Yedek yeni mimariyi taşıyor mu? — EVET, tam turla kanıtlandı

Alan listesini okumak yetmez; asıl soru dizilimin **tam turu** atlatıp atlatmadığı:

```
diz (köşe iddiası dahil) -> Backup -> her şeyi karıştır -> Restore -> birebir aynı mı?
```

`probes-newtab-desktop-ui/nt-roundtrip.mjs` — **8/8**:
ölçek iddiaya göre düştü · yedek yazıldı · **10 masa ayarının hepsi dosyada** ·
her ikonun (row,col) dosyada · masa karıştırıldı · **26/26 ikon tam hücresine döndü** ·
**aktif alan yeniden türedi (erişim 13x23 -> 13x23)** · masa hâlâ iddiaya göre ölçekli.

> **Aktif alan hiçbir yerde saklanmıyor — saklanmamalı da.** İkonların erişiminden yeniden
> türetiliyor. "Bölge genişletme yedeklendi mi?" sorusunun cevabı bu yüzden "ikonlar doğru
> hücreye döndü mü?" sorusuna eşit. Döndüler.

> ⚠️ **Ölçüm tuzağı:** hücre px'i iki okuma arasında farklıydı (0.2816 vs 0.3020) ve bu bir an
> regresyon sanıldı. Sebep **AlertBanner**: bir okumada vardı, diğerinde yoktu → kullanılabilir
> yükseklik 842 vs 900px. Karşılaştırılması gereken **erişim**, hücre px'i değil.

**Kapatılan boşluk:** `before-restore` snapshot'ı yalnız `browser.bookmarks` dalındaydı.
Local-only ve hata dalları dizilimi aynı şekilde eziyordu ama snapshot almıyordu. Üçünün de
üstüne taşındı.

**Boşluk sanılıp boşluk çıkmayan:** `has-organized` / `organized-layout` anahtarları yedeğe
girmiyor. Temizlenip yeniden yüklendi → **26/26 korundu** (kayıtlı konum varken yeniden düzenleme
yapılmıyor). Varsayımla "eksik" denip eklenmedi.

### 2. İkon/grid ölçek barı — `deskZoom`

```
capCell = maxCellSize(dialSize, squareDials, limitScale, maxScale, deskZoom)
```

Zoom **hücreye değil TAVANA** uygulanıyor. Sebep tek cümle: tavana uygulanınca tabana dönüşemez.
`cell = min(capCell, cellSizeThatFits(active))` olduğu için fit hesabı **her zaman son sözü söyler**
→ hiçbir zoom değerinde scroll doğmaz, hiçbir ikon ekran dışına itilmez.

| aralık | 0.40 – 2.50, adım 0.05, varsayılan 1.00 |
|---|---|
| aşağı | hücreler küçülür, **daha çok boş grid görünür** (yerleştirme alanı artar) |
| yukarı | hücreler büyür — **aktif alan sığmayı sınırlayana kadar** |

**Ölçülen tepki eğrisi** (1600×900):

| masa | zoom 0.4 | 0.8 | 1.0 | 1.5 | 2.0 | 2.5 |
|---|---|---|---|---|---|---|
| seyrek (erişim 3×10) | 31px | 62px | 78px | 116px | 138px | 138px |
| dolu (erişim 11×21) | 31px | 62px | 65px | 65px | 65px | 65px |

> **Dolu masada slider'ın üst yarısı etkisizdir ve bu bir bug DEĞİLDİR** — ikonlar zaten ekranı
> kaplıyorsa büyüyecek yer yoktur. Ama sessiz kalması kontrolü bozuk gösterir, o yüzden arayüz
> bunu **yazıyor**: canlı hücre px'i + *"held down to fit your furthest icon — zooming in further
> won't enlarge it"*. Okuma canlı masadan ölçülüyor (ayarlar masanın üstünde modal açılıyor);
> bağımsız options sayfasında masa yokken tavanı gösteriyor.

`nt-zoom.mjs` — **7/7**: küçülme grid'i açıyor · **hiçbir ikon kıpırdamıyor** (iki yönde de) ·
büyüme çalışıyor · tam yakınlaştırmada uzak köşe iddiası hâlâ ekranda · **aralığın hiçbir
noktasında scroll/kırpma yok**. Birim testte 8 test: tavanı ölçekler · Infinity'yi bozmaz ·
saçma değeri yutar · taban getirmez · konum değiştirmez.

### 3. "Base Screen" ölü müydü? — HAYIR, ama METNİ ölüydü

4 adımlı kanıt: `basePage` → `pageSize()` → `activeCols = active.cols || page.cols`.
Yani **yalnızca BOŞ masanın** başlangıç aktif alanını belirliyor. Referanslı, kanonik, çalışıyor
→ **korundu**. Ölü olan arayüz metniydi: hâlâ emekli sayfa modelini anlatıyordu
("*a wider monitor gets whole extra pages of desk beside and below it*") — bu davranış aylar önce
terk edilmişti. Başlık `Starting Desk Size` oldu, açıklama gerçekte yaptığı işi anlatıyor.

**Gerçekten ölü olan kaldırıldı:** `CanvasPlan.pagesX` / `pagesY` — üretiliyordu, **hiçbir yerde
tüketilmiyordu**. Emekli sayfa modelinin son kalıntısı. Aynı sayfa dilinin sızdığı 7 yorum/metin
de gerçeğe uyduruldu.

```
86 test PASS (78 -> +8) · build yeşil · tsc 34 = baseline
prob seti: page-probe PASS · drag 0/23 · release PASS · backup 8/8 · roundtrip 8/8 · zoom 7/7
```
