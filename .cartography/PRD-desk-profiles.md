# PRD — Desk Profiles

> **Durum:** taslak → onaylandı (kullanıcı, 2026-07-30)
> **Yazan:** Claude Opus 5 · **Dal:** `feat/desk-profiles` · **Taban:** `feat/position-backup-hardening` (a1ad273)
> **Yerini aldığı:** `deskZoom` canlı slider'ı (a1ad273'te eklendi, bu PRD ile emekli ediliyor)

---

## §1 · PROBLEM — ölçülmüş, varsayılmamış

Kullanıcının itirazı: *"ikonların size değişkenliği aynı zamanda grid yapısının ölçüsünü, en-boy
grid box sayısını da doğrudan etkiliyor. Kullanıcı zoom'u arttırırsa en dışardaki ikonlar
ekrandan taşacak, değil mi?"*

Bunu tahmin etmek yerine ölçtüm. **Sonuç ikiye ayrıldı: bir kısmı yanlış, asıl kısmı doğru.**

### 1.1 Taşma korkusu — GERÇEKLEŞMİYOR (kanıt)

Erişim 15×27 olan bir masa, 1600×900 pencerede, GÖRSEL kutu (transform sonrası) ölçümü:

| zoom | masa kutusu | alan | sığıyor | **ekran dışı ikon** | scroll |
|---|---|---|---|---|---|
| 0.4× | 1553×774 | 1600×842 | ✅ | **0 / 26** | yok |
| 1.0× | 1557×802 | 1600×842 | ✅ | **0 / 26** | yok |
| 1.5× | 1557×802 | 1600×842 | ✅ | **0 / 26** | yok |
| 2.0× | 1557×802 | 1600×842 | ✅ | **0 / 26** | yok |
| 2.5× | 1557×802 | 1600×842 | ✅ | **0 / 26** | yok |

Sebep yapısal: `cell = min(capCell, cellSizeThatFits(aktifAlan))`. Zoom yalnız `capCell`'i
büyütür; sığma hesabı **her zaman son sözü söyler**. Bu yüzden hiçbir zoom değeri bir ikonu
ekran dışına itemez.

> ⚠️ Bu ölçüm ilk denemede **yanlış** yapılmıştı: `getBoundingClientRect()` transform'lu elemanda
> zaten görsel kutuyu döndürür, ben bir kez daha `scale` ile çarpmıştım → taşma testi fazla
> hoşgörülüydü. Düzeltilip yeniden ölçüldü. `nt-zoom.mjs` içindeki aynı hata da düzeltilecek
> (bkz. T0).

### 1.2 Asıl sorun — ADRESLENEBİLİR ALAN zoom'a bağlı (kanıt)

Seyrek masa (erişim 3×10), 1600×900:

| zoom | grid | hücre | **yerleştirilebilir hücre sayısı** |
|---|---|---|---|
| 0.4× | 44×24 | 31px | **1056** |
| 1.0× | 17×9 | 77.6px | **153** |
| 2.5× | 10×5 | 138.5px | **50** |

**21 kat fark.** Kullanıcı zoom 0.4'te 44 kolonluk bir tuvale ikon yerleştirebilirken, zoom
2.5'te yalnız 10 kolon adresleyebiliyor — **34 kolon × 19 satır territory erişilemez oluyor.**

Bu, mimarinin *"ölü bölge yoktur, grid'in her pikseli geçerli bırakma hedefidir"* (I3) sözünü
zoom'a bağımlı hâle getiriyor. Söz teknik olarak tutuluyor (o anki grid'in her hücresi geçerli)
ama **grid'in kendisi kullanıcının altında değişiyor.**

### 1.3 İkinci sorun — slider zamanın yarısında ölü

Erişim 15×27 olan masada: zoom 1.0 → 50.7px, zoom 2.5 → 50.7px. Aynı. Aktif alan sığmayı
sınırladığı an slider'ın üst yarısı hiçbir şey yapmıyor. Arayüz bunu yazıyor
(*"held down to fit your furthest icon"*) ama **bir kontrolün yarısını açıklamak, o kontrolü
düzeltmek değildir.**

### 1.4 Teşhis

```
deskZoom ve territory expansion AYNI değişkeni (hücre boyutu) kontrol ediyor
ve territory HER ZAMAN kazanıyor.
İki kontrol birbiriyle güreşiyor; kullanıcı hangisinin kazandığını öngöremiyor.
```

Ekran alanı sonludur: `cols × cell ≤ availWidth`. `cols` ile `cell` **ters bağlıdır**.
Aynı anda "daha çok kolon" ve "daha büyük hücre" mümkün değildir. Herhangi bir tasarım
kullanıcının hangisini kontrol ettiğini **seçmek** zorundadır. Şu anki tasarım seçmiyor.

---

## §2 · KARAR — "hiç koymasak mı?" sorusunun cevabı

Üç seçenek değerlendirildi:

| # | seçenek | değerlendirme |
|---|---|---|
| A | **Desk Zoom'u tamamen kaldır** | §1.2/§1.3 sorunlarını çözer ama meşru ihtiyacı da öldürür: *hiçbir algoritma kullanıcının ekrana ne kadar uzakta oturduğunu bilemez.* 2 metredeki TV ile dizdeki laptop aynı çözünürlükte farklı ikon boyutu ister. |
| B | **Canlı slider'ı koru, uyarı metniyle idare et** | Mevcut hâl. Adreslenebilir alan hâlâ kullanıcının altında değişiyor; kontrolün yarısı hâlâ ölü. Açıklama, düzeltme değildir. |
| C | **Boyutu PROFİL bağlamına taşı** ⭐ | Kullanıcının önerisi. Boyut, düzenleme sırasında değişen canlı bir değişken olmaktan çıkıp bir cihaz bağlamının sabit özelliği hâline gelir. Her profil kendi diziliminde ve kendi ölçeğinde yaşar. |

**SEÇİLEN: C.** Gerekçe:

1. **Çakışmayı kaynağında çözer.** Boyut, dizilim yapılmadan ÖNCE seçilir; iki kontrol artık
   aynı anda güreşmez. Profil içinde `cellSize` sabit olduğu için adreslenebilir grid de sabittir.
2. **Meşru ihtiyacı korur.** Boyut hâlâ kullanıcının; sadece doğru kapsamda.
3. **Platform emsaliyle uyumlu.** macOS çoklu-ekran düzeninde ikon konumlarını *ekran
   yapılandırması başına* saklar; iOS/Android ana ekranı ızgarayı cihaz sınıfından türetir ve
   konumları (sayfa, satır, kolon) olarak tutar. Olgun platformların hepsi dizilimi bir
   **bağlama** bağlar. Bağlamayanlar (Windows ikon boyutu değişimi, macOS Finder ikon boyutu)
   dizilimi bozar ve kullanıcılar bundan şikâyet eder.
4. **Kullanıcının kendi senaryosunu birebir karşılar:** MacBook profili · iPhone profili ·
   TV profili, her biri kendi ölçeği ve kendi yerleşimiyle.

> **Prior-art notu (dürüstlük):** `~/.cartography/refpool` (816 repo) bu alan için **boş çıktı** —
> havuz Rust/TUI ağırlıklı, tarayıcı masaüstü-ızgarası emsali içermiyor. Yukarıdaki 3. madde
> havuzdan değil, platform davranışı bilgisinden geliyor ve öyle etiketlenmiştir.

---

## §3 · ÜRÜN TANIMI

### 3.1 Profil nedir

```
Profil = { id, name, cellSize, positions, screenHint? }
```

| alan | anlam |
|---|---|
| `id` | kararlı kimlik (üretilen) |
| `name` | kullanıcının verdiği ad — "MacBook", "TV", "iPhone" |
| `cellSize` | **px cinsinden hücre boyutu.** Profilin ikon ölçeği. Bu profilin `capCell`'i. |
| `positions` | `{ [bookmarkId]: { row, col } }` — bu profile ait dizilim |
| `screenHint` | profil oluşturulduğu andaki pencere ölçüsü (yalnız bilgi amaçlı, otomatik geçiş YOK) |

**Yer imleri paylaşılır, konumlar paylaşılmaz.** Bir yer imi silinirse her profilden düşer;
bir profilde taşınması diğerini etkilemez.

### 3.2 Boyut semantiği — hâlâ TAVAN

`profile.cellSize` doğrudan `capCell` olur:

```
cell = min(profile.cellSize, cellSizeThatFits(aktifAlan, pencere))
```

Yani seçilen boyut **hedeftir, garanti değil**: dizilim pencereye sığmıyorsa yine küçülür.
Bu, I4 (taban yok, scroll yok, kırpma yok) değişmezini korur. Fark şu: profil içinde
`cellSize` **değişmediği için** adreslenebilir grid de kararlıdır — §1.2'deki 21 katlık
oynama ortadan kalkar.

### 3.3 Boyut ne zaman ayarlanır

Kullanıcının isteği: *"1 icon veya hiç icon yokken size değiştirilebilir olmalı, kullanıcı tek
bir icona bakarak referansını görebilsin."*

- **Yeni profil BOŞ başlar.** Dizilimi olmadığı için boyut serbestçe ayarlanır — bozulacak bir
  şey yoktur. Doğal akış: profil oluştur → boyutu ayarla (canlı referansla) → ikonları yerleştir.
- **Canlı referans:** boyut kontrolünün yanında **gerçek px boyutunda örnek bir dial** çizilir,
  yanında ortaya çıkacak masa ölçüsü yazılır (*"masanız 16 × 9 hücre olacak"*).
- **Dolu profilde de değiştirilebilir** — ölçümle kanıtlandı ki hiçbir ikon kaybolmaz/taşmaz
  (§1.1). Ama adreslenebilir boş alan değişir, o yüzden arayüz değişimi **önceden** gösterir
  (*"21 × 11 → 10 × 5"*). Kilit değil, bilgilendirme.

### 3.4 `deskZoom`'un akıbeti

`deskZoom` **kaldırılır**. Yeteneği `profile.cellSize` devralır. Göç: mevcut `deskZoom` değeri
varsayılan profilin `cellSize`'ına çarpılarak taşınır (`cellSize = maxCellSize(dialSize,…) × deskZoom`),
böylece kullanıcının mevcut görünümü **birebir korunur**.

---

## §4 · MİMARİ — bağımlılık zinciri

### 4.1 Mevcut zincir

```
settings.deskZoom ──┐
settings.dialSize ──┼─> maxCellSize() ─> capCell ─┐
settings.squareDials┤                             │
limitDialScale/maxDialScale ──────────────────────┤
                                                  ├─> resolveCanvas() ─> {cols,rows,cell,scale}
panelBookmarks ─> contentExtent() ─> activeAreaRef┤
pencere ─> measureGridArea() ─> availW/H ─────────┘
settings.gridCols/gridRows ─> fixed ──────────────┘
```

### 4.2 Kritik kısıt — 28 yazma yolu

`panelBookmarks`'a yazan **28 ayrı yol** var (`setPanelBookmarks` / `updatePanelBookmarksWithSave` /
`savePanelBookmarks`). Hepsine dokunmak kabul edilemez risk.

**Ama hepsi tek depolama dikişinden geçiyor:** `savePanelBookmarks()` ve `loadPanelBookmarks()`.
Snapshot katmanı (7ffee60) tam olarak oraya konuldu ve sorunsuz çalıştı — **kanıtlanmış dikiş.**

### 4.3 Seçilen yerleşim — depolama dikişinde projeksiyon katmanı

```
                    ┌─────────────────────────────────────┐
28 yazma yolu ─────>│ savePanelBookmarks(list)            │
                    │   1. localStorage panel-bookmarks   │  <- DEĞİŞMEDİ
                    │   2. recordSnapshot()               │  <- DEĞİŞMEDİ
                    │   3. profiles.syncActive(list)  YENİ│
                    └─────────────────────────────────────┘
                    ┌─────────────────────────────────────┐
başlangıç ─────────>│ loadPanelBookmarks()                │
                    │   1. panel-bookmarks oku            │  <- DEĞİŞMEDİ
                    │   2. profiles.project(list)     YENİ│
                    └─────────────────────────────────────┘

profil değiştir ──> profiles.setActive(id) ─> panel-bookmarks'ı o profilden yeniden yaz
                                            ─> mevcut yükleme yolu devralır
```

**Grid'in render/drag/senkron mantığına HİÇ dokunulmuyor.** Profil katmanı yalnız iki
fonksiyonu sarıyor. Blast radius: 2 fonksiyon + `capCell` kaynağı + ayarlar arayüzü.

### 4.4 Depolama

| anahtar | içerik | durum |
|---|---|---|
| `panel-bookmarks` | aktif profilin dizilimi, mevcut şekil | **değişmedi** (uyumluluk) |
| `panel-bookmarks-history` | snapshot halkası | **değişmedi** |
| `desk-profiles` | `{ version, activeId, profiles: [...] }` | **YENİ** |

Aktif profilin konumları `panel-bookmarks`'ta **yansıtılmış** hâlde durmaya devam eder →
snapshot/kurtarma/yedek zinciri olduğu gibi çalışır.

### 4.5 Göç (migration)

Uygulama ilk kez `desk-profiles` bulamadığında:

1. Mevcut `panel-bookmarks` konumlarından **"Default"** adlı tek profil üretilir.
2. `cellSize = maxCellSize(dialSize, squareDials, limitDialScale, maxDialScale, deskZoom)` —
   yani kullanıcının o anki görünümü birebir korunur.
3. `deskZoom` ayarı silinir (artık `cellSize` içinde).
4. `desk-profiles` yazılır, `panel-bookmarks` **değiştirilmez**.

Göç **idempotent** ve **kayıpsız** olmalıdır; testle çivilenir (TP-M1..M3).

---

## §5 · TEST PLANI — kod yazılmadan ÖNCE

> Her test noktası: **ne** test edilir · **beklenen sonuç** · **neden bu beklenti** (hangi
> değişmezi/kararı korur). Beklentiyi gerekçesiz yazmak, testi sonradan sonuca uydurmaya davettir.

### 5.1 Saf birim testleri — `deskProfiles.test.ts`

| TP | ne | beklenen | neden |
|---|---|---|---|
| **TP-C1** | Boş depodan profil listesi | `[]` değil, **1 varsayılan profil** | Uygulamanın profilsiz durumu olmamalı; her yol bir aktif profil bulabilmeli, aksi hâlde 28 yazma yolunun her biri null kontrolü ister |
| **TP-C2** | Profil oluştur | yeni id, **boş `positions`** | §3.3: yeni profil boş başlar ki boyut serbestçe ayarlanabilsin |
| **TP-C3** | Profil adı benzersiz değil | kabul edilir, id farklı | Ad kullanıcı etiketidir; benzersizlik dayatmak gereksiz sürtünme |
| **TP-C4** | Son profili sil | **reddedilir** | Aktif profil daima var olmalı (TP-C1 gerekçesi) |
| **TP-C5** | Aktif profili sil | silinir, **aktiflik başka profile geçer** | Sarkan `activeId` bırakmak = açılışta boş masa |
| **TP-C6** | Profil kopyala | konumlar **derin kopya**, bağımsız | Referans paylaşımı bir profildeki taşımayı diğerine sızdırır |
| **TP-C7** | `cellSize` sınır dışı (0, negatif, NaN, 5000) | **kenetlenir**, atılmaz | Bozuk değer masayı çökertmemeli; `deskZoom`'da da aynı koruma vardı |
| **TP-P1** | `syncActive(list)` | aktif profilin `positions`'ı listeyle eşleşir | Depolama dikişinin yazma yönü |
| **TP-P2** | `project(list)` — profilde konum var | listedeki `(row,col)` profilden gelir | Okuma yönü; profil değişimini görünür kılan tek mekanizma |
| **TP-P3** | `project(list)` — profilde konumu olmayan yer imi | **düşürülmez**, konumsuz döner | Yeni yer imi her profilde görünmeli; düşürmek veri kaybı gibi görünür |
| **TP-P4** | `project` — profilde olup listede olmayan id | yok sayılır, hata yok | Silinen yer iminin hayalet konumu masayı bozmamalı |
| **TP-P5** | Yalnız full-screen girdileri etkilenir | panel girdileri **dokunulmaz** | 2/3/4-panel düzenleri profilsizdir; onlara bulaşmak kapsam dışı regresyon |
| **TP-M1** | Göç: `desk-profiles` yok, `panel-bookmarks` dolu | 1 profil, konumlar birebir | §4.5 kayıpsızlık |
| **TP-M2** | Göç: `deskZoom = 1.5` | `cellSize == cap × 1.5` | Kullanıcının mevcut görünümü korunmalı, yoksa güncelleme masasını değiştirir |
| **TP-M3** | Göç iki kez çalışır | ikinci çalışma **no-op** | İdempotent değilse her açılışta profil çoğalır |
| **TP-M4** | Göç: `panel-bookmarks` bozuk | profil yine oluşur, boş konumla | Göç, kurtarma yolunu (7ffee60) kilitlememeli |
| **TP-S1** | Depolama kotası dolu | **`false` döner, atmaz** | Profil yazımı asıl kaydı riske atmamalı (snapshot'taki aynı kural) |
| **TP-S2** | `desk-profiles` bozuk JSON | varsayılan profile düşer | Bozuk yardımcı depo uygulamayı açılmaz hâle getirmemeli |

### 5.2 Layout matematiği — `layout.test.ts` eklemeleri

| TP | ne | beklenen | neden |
|---|---|---|---|
| **TP-L1** | `capCell = profile.cellSize` ile çözüm | hücre **tam olarak** `cellSize` (sığdığı sürece) | Profilin sözü bu: seçtiğin boyutu alırsın |
| **TP-L2** | Dizilim pencereye sığmıyor | hücre **küçülür**, `cellSize`'ın altına iner | I4: taban yok, scroll yok — profil bunu **bozmamalı** |
| **TP-L3** | Aynı `cellSize`, iki farklı pencere | **grid ölçüsü değişir, hücre aynı** | Profilin asıl kazancı: adreslenebilir alan artık pencereye bağlı, boyuta değil |
| **TP-L4** | `cellSize` sabitken ikon eklenip çıkarılması | hücre **değişmez** (sığdığı sürece) | §1.2'nin panzehiri: tuval kullanıcının altında oynamamalı |

### 5.3 Canlı tarayıcı probları — `nt-profiles.mjs`

| TP | ne | beklenen | neden |
|---|---|---|---|
| **TP-B1** | Profil oluştur → boyut ayarla → 3 ikon yerleştir → diğer profile geç → geri gel | dizilim **birebir** geri gelir | Özelliğin varlık sebebi |
| **TP-B2** | A profilinde ikon taşı, B profiline bak | B **etkilenmez** | Profil izolasyonu; sızarsa özellik anlamsız |
| **TP-B3** | Profil değişiminde hücre boyutu | hedef profilin `cellSize`'ına geçer | Boyut profilin özelliği |
| **TP-B4** | Aynı profilde ikon ekle/çıkar/taşı | **adreslenebilir grid ölçüsü sabit kalır** | §1.2'nin doğrudan panzehiri — bu testin geçmesi PRD'nin ana iddiasıdır |
| **TP-B5** | Küçük pencerede büyük `cellSize` profili | **0 ikon ekran dışı, scroll yok** | I4 korunuyor (§1.1 ölçümünün profil hâlindeki karşılığı) |
| **TP-B6** | 12 ekran boyunda aktif profil | **dizilim değişmez** | I1 — mevcut değişmez bozulmadı |
| **TP-B7** | Yedek al → profilleri boz → geri yükle | **tüm profiller + aktif profil** döner | Yedeğin kapsamı genişledi, kanıtlanmalı |
| **TP-B8** | Profil silinince o profilin konumları | temizlenir, diğerleri sağlam | Sızıntı/şişme kontrolü |

### 5.4 Regresyon kapısı (her adımdan sonra)

| kapı | eşik | neden |
|---|---|---|
| `npx vitest run` | **hepsi PASS** (86 + yeniler) | Geriye fail test bırakılmayacak |
| `npm run build` | ✓ | |
| `npx tsc -b` | **34** (baseline, artmayacak) | Artış = yeni tip hatası |
| `ntdui-page-probe` | VERDICT: PASS | I1 |
| `nt-drag-verify` | diğerleri **0/N** kıpırdadı | I2 |
| `nt-release` | alan serbest bırakılıyor | I6 |
| `nt-backup` | 8/8 | depolama ağı |
| `nt-roundtrip` | 8/8 | yedek turu |

---

## §6 · GÖREV KIRILIMI

| # | görev | alt adımlar | çıktı |
|---|---|---|---|
| **T0** | Ölçüm hatasını düzelt | `nt-zoom.mjs` çifte-scale hatası | doğru prob |
| **T1** | `deskProfiles.ts` saf modül | tip · CRUD · project/sync · clamp · kota güvenliği | modül |
| **T2** | `deskProfiles.test.ts` | TP-C1..C7, TP-P1..P5, TP-S1..S2 | 16+ test |
| **T3** | Göç | migrate() · deskZoom devralma · idempotan | TP-M1..M4 |
| **T4** | Depolama dikişi entegrasyonu | `save`/`load` sarma · `setActive` | Grid'e 2 nokta |
| **T5** | `capCell` kaynağı | `deskZoom` → `profile.cellSize` · layout testleri | TP-L1..L4 |
| **T6** | Ayarlar arayüzü | profil listesi · oluştur/adlandır/sil/kopyala · boyut kontrolü + **canlı referans dial** + masa ölçüsü önizleme | UI |
| **T7** | Yedek/geri-yükleme | `desk-profiles` yedeğe · restore · reset | TP-B7 |
| **T8** | Canlı problar | `nt-profiles.mjs` TP-B1..B8 | 8 kontrol |
| **T9** | `deskZoom` emekliliği | ayar · handler · UI · testler · backup alanı | temizlik |
| **T10** | Kapılar + kayıt + commit | SYSTEM-MAP · devir belgesi · push | yeşil |

---

## §7 · RİSKLER

| risk | olasılık | etki | önlem |
|---|---|---|---|
| Profil projeksiyonu 28 yazma yolundan biriyle yarışır | orta | dizilim bozulur | Dikişte tek nokta; TP-B2/B4 canlı prob |
| Göç kullanıcının mevcut görünümünü değiştirir | orta | güven kaybı | TP-M2 birebir `cellSize` devri |
| `desk-profiles` kotayı doldurur | düşük | kayıt başarısız | TP-S1: profil yazımı asıl kaydı riske atmaz |
| Profil değişiminde snapshot halkası kirlenir | orta | geçmiş anlamsızlaşır | Profil değişimi `reason: "profile-switch"` ile işaretlenir |
| Kapsam şişmesi (otomatik ekran eşleme) | yüksek | teslim edilemez | **Otomatik geçiş KAPSAM DIŞI.** `screenHint` yalnız bilgi. |

**KAPSAM DIŞI (bu turda yapılmayacak):** ekran ölçüsüne göre otomatik profil değişimi ·
profil dışa/içe aktarma dosyası · profil başına duvar kağıdı/tema · bulut senkronu.
