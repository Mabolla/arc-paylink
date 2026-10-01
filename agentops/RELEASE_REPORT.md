# Arc PayLink — şirket tahsilatı ve AgentOps teslim raporu

Güncelleme: 1 Ekim 2026. Çalışma `feat/tameion-agentops` dalında, taslak [PR #14](https://github.com/Mabolla/arc-paylink/pull/14) içindedir. Ana canlı ürüne birleştirilmedi.

## Eklenen ürün akışı

Şirket sipariş/fatura için ödeme linki oluşturur. Müşteri linki açar, Google ile Circle gömülü hesabına giriş yapar, USDC ödemesini onaylar. Tahsilat şirket paneline ve şirketin agent araçlarına yansır. Bu akışın uygulama kodu eklendi; çalışma yalnızca önceki ödeme yapan agent prototipinden ibaret değildir.

| Bölüm | Eklenen işlev |
| --- | --- |
| Şirket paneli | Çalışma alanı, ödeme linki oluşturma, özel müşteri referansı, vade, arama/filtre, tahsilat toplamları, CSV ve link paylaşma. |
| Müşteri ekranı | Google/Circle hesabı akışı ve mevcut EVM cüzdanı seçeneği; USDC bakiyesi, sabit tutar/alıcı için onay, kesinti sonrası makbuz doğrulama. |
| Agent bağlantısı | Uzaktan MCP: sipariş listesi/ayrıntısı, tahsilat özeti ve ödeme olayları. Şirkete özel, yalnızca okuyan, iptal edilebilir anahtar. |
| Veri güvenilirliği | Kalıcı özel kayıtlar, şirket bazlı erişim, atomik ödeme rezervasyonu, mükerrer fatura/işlem engeli ve bağımsız Arc doğrulaması. |
| Arka plan bildirimi | Circle imzalı webhook doğrulaması ve zincir kontrolü. Bildirim gelmesi için hesapta abonelik ayrıca bağlanmalıdır. |
| Önceki AgentOps | Şirket adına insan onayıyla ödeme ve mükerrer transfer yapmadan kurtarma katmanı korundu. |

## Ekranlar

- Gerçek çalışma alanı: `/business`
- Etkileşimli deneme: `/business/demo`
- Müşteri satın alma sayfası: `/checkout/<orderId>`
- Şirket agent bağlantısı: `/api/business/mcp`
- Önceki ödeme yapan agent senaryosu: `/agentops-demo/index.html`

Deneme alanındaki işlemler açıkça simülasyondur; tarayıcıda yerel veri kullanır. Gerçek sunucu API'sinde sahte ödeme tamamlayan bir yol yoktur. Ödeme için müşterinin doğru Arc ağında yeterli USDC'si gerekir. Kartla/fiat ödeme bu sürümde bulunmaz.

## Doğrulama

208 uygulama testi içinde 40 ödeme yapan AgentOps, 32 şirket tahsilatı, 8 arka plan okuyucu ve 3 deployment makbuzu yeniden deneme testi bulunuyor. Şirketler arası erişim, anahtar iptali, eş zamanlı ödeme, zaman aşımı, yanlış tutar/gönderen/ağ/makbuz, işlem tekrar kullanımı, kayıt arızası ve imzalı bildirim tekrarı kapsanıyor. MCP istemci protokolü hem yerel taşıma hem HTTP üzerinden sınandı.

Tarayıcı senaryosu: sipariş oluştur → müşteri ekranını aç → simüle onay → panelde ödenmiş sipariş → agent raporu. Mobil görünüm ve mevcut alıcı cüzdanına dönüş kontrol edildi. Sonuçlar `evidence/collections-ui.json` içinde. Lint, TypeScript, üretim derlemesi ve mevcut sözleşme testleri ayrıca çalıştırılır; en son sonuç PR'da raporlanır.

## Yayımlanan sunucuda gerçek API kontrolü

Önizlemede gerçek özel veri deposuyla şirket kaydı ve test siparişi oluşturuldu. Siparişin kalıcı kaydı, müşteri sayfasının özel alanları gizlemesi, agent anahtarının okuma yapıp yazma yapamaması ve uzaktan MCP tahsilat toplamı doğrulandı. Test siparişi iptal edildi, geçici agent anahtarı kaldırıldı. Para gönderilmedi. Circle/gömülü cüzdan yapılandırması sunucuda mevcut. Kanıt: `evidence/collections-deployed.json`.

## Tamamlanan gerçek mainnet kabul testi

1 Ekim 2026, 21:25 Türkiye saati: mevcut proje cüzdanı `0xE7be…5b3dd` ile yine aynı anahtarın kontrolündeki, ayrı test alıcı adresine **0,01 USDC** gönderildi. İmza GitHub'ın mevcut güvenli secret'ı ile runner içinde atıldı; anahtar dışarı aktarılmadı. Bu ödeme harici müşteri satışı değildir.

- İşlem: `0x892cee4be94814a5fd0da6fb7408b5811738ce5bfe311ae45e2e87a05e736158`
- Arc mainnet: `5042`; blok: `23751439`.
- Gerçek işlem ücreti: `0.001478760025582548 USDC`.
- Sipariş: `604c797f-68d3-40bd-a483-bc7a36e7a33c`; müşteri ekranı ve şirket kaydı `paid`.
- Uzaktan MCP: 1 ödenmiş sipariş, 0,01 USDC tahsilat, 0 açık bakiye; aynı zincir makbuzu.
- Aynı makbuz yeniden doğrulanınca yalnızca 1 ödeme olayı kaldı. Geçici agent anahtarının yazma yetkisi reddedildi ve test sonunda anahtar iptal edildi.
- Kanıtlar: [işlem](evidence/collections-mainnet-transaction.json), [şirket/agent kabulü](evidence/collections-mainnet.json), [gerçek müşteri ekranı](evidence/collections-mainnet.jpg).

Bu test, mevcut cüzdanla API üzerinden imza ve ödeme → bağımsız zincir doğrulaması → şirket kaydı → agent okuması zincirini doğrular. Tarayıcı uzantısındaki onay veya Google/Circle girişiyle yapılmış bir ödeme gibi sunulmaz. Doğrulanmış harici müşteri sayısı hâlâ **0**.

Ön kontrolde mevcut anahtarın `0x` öneki olmadan saklandığına uyum sağlandı. Önizlemede mainnet seçiliyken eski RPC ayarının testnet'e gittiği de yakalandı; tahsilat katmanı açıkça seçilen ağın resmî RPC'sine bağlandı. Yanlış ağ kontrolü korunuyor. Eski canlı ürünün ağı veya ayarları değiştirilmedi.

## Gerçek hesap kabulü

Yeni akışta gerçek müşterinin Google/Circle oturumu ile zincirde satın alma henüz yapılmadı. Önizlemede Google girişi `400 redirect_uri_mismatch` verdi; tam `/wallet` callback adresi sağlayıcı izinlerinde henüz kabul edilmiyor. Circle hesabı üzerinden onay ve webhook aboneliği ayrıca doğrulanmalıdır. Kodun bulunması bu dış bağlantıların aktif olduğunu kanıtlamaz. Simülasyon gerçek kullanıcı veya tahsilat hacmi olarak sayılmaz.

Önceki Circle Agent Wallet CLI girişini otomatik onay denetimi, kullanım şartlarının kabulü ve telemetri nedeniyle durdurmuştu. Resmî `DO_NOT_TRACK=1` seçeneği adaptöre eklendi; açık şart onayı ve güvenli hesap oturumu olmadan CLI girişi tekrar denenmedi. Ödeme alt süreçleri artık üst ortamdan gelen `CIRCLE_ACCEPT_TERMS` değişkenini de kaldırıyor. Bu ayrı engel şirket paneli ve gömülü müşteri akışının geliştirilmesini durdurmadı.

Tarayıcıdan bağımsız salt-okuma tahsilat okuyucusu eklendi. Gerçek önizlemede iki ayrı çalıştırma yapıldı: ilkinde 1 makbuz, ikincisinde 0 yeni makbuz; kalıcı kayıt aynı işlem hash’ini korudu. Geçici okuyucu anahtarı iptal edildi. Yeni transfer yapılmadı. Kanıt: [collections-watch.json](evidence/collections-watch.json); işletim ve kurtarma: [COLLECTIONS_WATCH.md](COLLECTIONS_WATCH.md). Sürekli çalışan servis henüz kurulmadı.

Agentin düzenli sorgulamaları kendi çalışma ortamında zamanlanır. Bilinmeyen ödeme sonucu otomatik sıfırlanmaz. Muhasebe yazılımı bağlantısı, otomatik iade ve kart ödeme bu sürümün kapsamı dışındadır. Ayrıntılar [COLLECTIONS.md](COLLECTIONS.md).

## Ana ürün ve başvurular

Sözleşmeler, mevcut ödeme/claim API'leri ve deployment scriptleri değiştirilmedi. Ana sayfaya şirket paneli bağlantısı, `/wallet` sayfasına satın alma dönüşünü yöneten sınırlı bir sarmalayıcı eklendi. Yeni kayıtlar ayrı `commerce/v1` alanındadır. Ana dal ve üretim dağıtımı değiştirilmedi.

Önceki uygulama commit’i `98f2880` için GitHub Actions run 53 tamamen başarılı: bağımlılıklar, lint, 188 uygulama + 13 sözleşme testi, üretim derlemesi, değişmemiş mainnet deployment doğrulaması ve salt-okuma preflight geçti. Vercel önizlemesi de başarıyla yayımlandı. Önceki makbuz/RPC tutarsızlığı bu çalışmada tekrarlanmadı; doğrulama kontrolü gevşetilmedi.

Tameion formu gönderilmedi; mevcut Microgrants başvurusu düzenlenmedi. İngilizce taslak [SUBMISSION.md](SUBMISSION.md) yeni şirket akışını ve gerçek kabul sınırlarını içeriyor.

Son uygulama düzeltmesi `ebbae15` ve gerçek ödeme çalışması `b6e7885` için GitHub doğrulamaları başarılıdır: 196 uygulama + 13 sözleşme testi, lint, derleme, değişmemiş mainnet sözleşme doğrulaması ve salt-okuma preflight. Gerçek ödeme run ID: `36906656820`; uygulama doğrulama run ID: `36906663777`. Ana dal `e82173d7580f1698f503d544202b986c143fd2a9` olarak kaldı; canlı ana sayfa ve `/wallet` HTTP 200 ve ana arayüz tarayıcıda doğrulandı.

Eski canlı uygulamanın yayımlanmış istemci paketi ayrıca kontrol edildi: `https://rpc.mainnet.arc.io` kullanıyor. Yakalanan testnet RPC kalıntısı ayrı önizleme ortamına aitti.

## Son devam çalışması

`42d9584` için doğrulama run `36907479345` ilk denemede yalnızca eski deployment makbuzunun geçici olarak bulunamaması nedeniyle durdu. Aynı kodla yeniden çalıştırılan job `110523348036` tamamen başarılıdır. Bu geçici eksik makbuz hatasına özel, 4 denemeyle sınırlı toplam 7 saniyelik bekleme eklendi; receipt, blok, adres, bytecode ve getter kontrolleri korunuyor. Yerel 208 uygulama + 13 sözleşme testi, lint ve üretim derlemesi geçti.

Google yönetim konsolu bu ortamda `Site Unavailable` verdi; Circle Console erişimi bu tarayıcıya reddetti. Ayarlar değiştirilmedi. Tam callback, kısıtlı webhook aboneliği ve canlı kabul ölçütleri [CONFIGURATION_ACCEPTANCE.md](CONFIGURATION_ACCEPTANCE.md) içinde somutlaştırıldı. Bu iki hesap tarafı kabulü ve sürekli çalışan host kurulmadan sürümün tamamı bitti denmez.

Yeni şirket/müşteri sürümü için `/collections-demo/index.html` ürün turu ve 72 saniyelik İngilizce altyazılı ekran görüntüsü videosu hazırlandı. Video ilk üç sahnede simülasyonu, devamında daha önce tamamlanan gerçek iç test makbuzunu ve okuyucu sonucunu gösterir; canlı Google/Circle onayı kaydı değildir. Kaynak ekran görüntüleri ve kapsam kaydı GitHub’dadır. Ayrıntı: [COLLECTIONS_DEMO.md](COLLECTIONS_DEMO.md).

Uygulama commit’i `fd72e54` için run `36911279409`, job `110534241970` tamamen geçti: 208 uygulama + 13 sözleşme testi, lint, derleme, mainnet deployment doğrulaması ve salt-okuma ağ kontrolü. Vercel başarılı; canlı ürün turu tarayıcıda kontrol edildi, makbuz görseli yüklendi ve sayfada yatay taşma yok. HTML, kanıt JSON'u, 72 saniyelik video ve altyazı dosyası HTTP 200 ile yayımlandı; yerel dosyalarla byte byte eşleşti. Kanıt: [collections-release-acceptance.json](evidence/collections-release-acceptance.json), [canlı ürün turu](evidence/collections-tour.jpg). Son görsel kontrolde müşteri sayfasının alt etiketi, mevcut cüzdanla ödeme sonucunu da doğru tanımlayacak şekilde genel USDC/Arc ifadesine düzeltildi.
