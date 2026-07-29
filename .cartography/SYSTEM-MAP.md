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
