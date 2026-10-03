# Arc PayLink — şirket tahsilatı ve AgentOps teslim raporu

Güncelleme: 3 Ekim 2026. Uygulama çalışması `feat/tameion-agentops` dalında, taslak [PR #14](https://github.com/Mabolla/arc-paylink/pull/14) içindedir. Ayrı takip projesinin dağıtım dalı `deploy/collections-monitor` olarak oluşturuldu. Ana canlı ürüne birleştirilmedi.

## Eklenen ürün akışı

Şirket sipariş/fatura için ödeme linki oluşturur. Müşteri linki açar, Google ile Circle gömülü hesabına giriş yapar, USDC ödemesini onaylar. Tahsilat şirket paneline ve şirketin agent araçlarına yansır. Bu akışın uygulama kodu eklendi; çalışma yalnızca önceki ödeme yapan agent prototipinden ibaret değildir.

| Bölüm | Eklenen işlev |
| --- | --- |
| Şirket paneli | Çalışma alanı, ödeme linki oluşturma, özel müşteri referansı, vade, arama/filtre, tahsilat toplamları, CSV ve link paylaşma. |
| Müşteri ekranı | Google/Circle hesabı akışı ve mevcut EVM cüzdanı seçeneği; USDC bakiyesi, sabit tutar/alıcı için onay, kesinti sonrası makbuz doğrulama. |
| Agent bağlantısı | Uzaktan MCP: sipariş listesi/ayrıntısı, tahsilat özeti ve ödeme olayları. Şirkete özel, yalnızca okuyan, iptal edilebilir anahtar. |
| Veri güvenilirliği | Kalıcı özel kayıtlar, şirket bazlı erişim, atomik ödeme rezervasyonu, mükerrer fatura/işlem engeli ve bağımsız Arc doğrulaması. |
| Arka plan bildirimi | Circle imzalı webhook doğrulaması ve zincir kontrolü. İzin düzeltmesi sonrası aktivasyon testi yeşile döndü; sunucunun gerçek metadata okuması bu yayına ait etkin outbound aboneliğini doğruladı. Gerçek ödenmiş sipariş bildirimi henüz kabul edilmedi. |
| Sunucuda takip | Özel kalıcı rapor, kesinti sonrası devam, aynı makbuzu tekrar saymama ve çakışan görev koruması; panelde son rapor, agentte beşinci okuma aracı ve yeni Check now eylemi. Otomatik zamanlama henüz aktif değil. |
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

Yeni akışta Google/Circle oturumu ile zincirde satın alma henüz yapılmadı. İlk önizleme denemesinde Google girişi `400 redirect_uri_mismatch` verdi; bu geçmiş hata, hesap sahibinin tam önizleme `/wallet` callback adresini Google OAuth izinlerine eklemesi ve Google girişini onaylaması sonrasında çözüldü.

Son gerçek kabulde önizleme `/wallet` sayfası `Wallet connected. Your balance is read directly from Arc.` mesajını, Circle kullanıcı kontrollü cüzdanı `0xcffc8fee9d782497fdb74909a3843948df34df31` ve Arc üzerinde **0 USDC** bakiyeyi gösterdi. Google girişi, Circle cüzdan bağlantısı ve canlı bakiye okuması geçti. Kanıt: [giriş kabul kaydı](evidence/collections-google-auth.json) ve [bağlı cüzdan ekranı](evidence/collections-google-auth.jpg). Bu adımda yeni transfer yapılmadı; doğrulanmış harici müşteri sayısı **0** olarak kaldı.

Cüzdanın USDC ile fonlanması, yeni müşteri siparişinin tam tutar için Circle üzerinden onaylanması, zincir makbuzu ve gerçek webhook teslimi ayrı kabul adımlarıdır. Başarılı giriş bu ödeme adımlarının tamamlandığı anlamına gelmez. Simülasyon gerçek kullanıcı veya tahsilat hacmi olarak sayılmaz.

Circle bildirim aktivasyonu için yapılan gerçek imzalı testte sunucu HTTP **502** verdi. Sebep, Circle imza anahtarı okuma isteğinin HTTP **403**, sağlayıcı hata kodu **3** ile reddedilmesiydi. Hesap sahibinin gördüğü mevcut mainnet kısıtlı anahtarda Webhooks izni yoktu; Wallets izni Read + Write olarak duruyordu. Hesap sahibi aynı anahtarda yalnızca **Webhooks Read Only** iznini kaydetti; diğer izinleri, anahtarın kendisini ve IP politikasını korudu. Sonrasında aktivasyon testinin yeşile döndüğünü bildirdi.

İlk sonuç hesap sahibinin başarılı aktivasyon testi bildirimiydi. Sonrasında sunucunun gerçek metadata okuması tam bu yayının callback adresine ait etkin outbound aboneliğini bağımsız doğruladı. Abonelik kimliği ve konsol ekranı saklanmadı; tarayıcı kapalıyken gerçek Circle siparişinin ödenmişe dönüşmesi ve aynı bildirimin tekrarında tek makbuz kalması hâlâ bekliyor. Aktivasyon ve readiness kabulü yeni ödeme veya müşteri anlamına gelmez. Bu adımlarda yeni transfer **0**, doğrulanmış harici müşteri **0**; ham sağlayıcı logu, API anahtarı, anahtar öneki veya hesap ekranı yayımlanmadı.

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

Tarayıcıdan bağımsız takip artık uygulamanın sunucusunda da çalıştırılabilir. `GET /api/business/monitor` güvenli raporu okur; owner yetkisiyle tek seferlik kontrol ayrı uçtan, aynı şirkete ait okuyucu anahtarıyla yapılır. Cron ucu yalnızca ayrı güçlü sunucu secret'ı ve sabit şirket/okuyucu yapılandırmasıyla çalışır. Özel kalıcı depoda ETag kilidi, yarım sayfa kaydı ve makbuz kimliğiyle tekrar kontrolü kullanılır. Okuma araçları görev başlatamaz; takip hiçbir ödeme göndermez veya siparişi sahte şekilde ödenmiş yapmaz.

Bu eklemeden sonra 232 uygulama testi, lint ve üretim derlemesi yerelde geçti. 14 sunucu takip testi; kesinti, çakışma, süresi dolan görevin yeni görevi bozamaması ve anahtar iptalini kapsar. 8 HTTP sınır testi; sabit ağ/şirket, ayrı cron kimliği, owner/reader sınırı ve güvenli rapor alanlarını kapsar. Canlı sunucu kabulü ve otomatik zamanlama ayrı ayrı doğrulanacaktır. İşletim ayrıntıları: [COLLECTIONS_MONITOR.md](COLLECTIONS_MONITOR.md). Ana proje yapılandırmasına cron eklenmedi; yeni üretim projesi için ayrı şablon hazırlandı.

Canlı sunucu kabulü artık geçti: iki tamamlanmış tarama, 1 kalıcı makbuz, 0,01 USDC tahsilat ve 0 açık bakiye; ikinci taramada 0 yeni makbuz. Şirket API'si ile uzaktan MCP aynı raporu verdi. Okuyucu anahtarı görev başlatamadı, test anahtarı iptal edildi ve sonraki erişimi reddedildi. Önceki zincir makbuzu değişmedi, yeni para gönderilmedi. Kanıt: [collections-monitor.json](evidence/collections-monitor.json).

Şirket panelindeki yeni **Check now** eylemi, owner oturumunda şirkete özel geçici okuyucu anahtarı oluşturur, mevcut sunucu kontrolünü çalıştırır ve işlem sonu temizliğinde anahtarı iptal etmeyi dener. Sayfadan ayrılmada temizlik en iyi gayretle yapılır; başarısız temizlik için yeniden deneme görünür ve kesilen oturumda Agent access bölümünde kalan anahtar kontrol edilmelidir. Çalışma alanı değişince yerel anahtar/kurulum durumu sıfırlanır. Kullanıcının API isteği yazması veya worker kurması gerekmez. Bu tek seferlik kontrol para göndermez ve otomatik zamanlamayı açmaz.

Yeni arayüz için hedefli lint, TypeScript, üretim derlemesi ve altı mock yaşam döngüsü kontrolü geçti; yayımlanmış gerçek Check now arayüzü kabulü hâlâ bekliyor. On yeni webhook HTTP testi de yerelde geçti: imzalı aktivasyon, eksik/değiştirilmiş imza, imza anahtarı erişim hataları, eksik kimlik bilgisi, yanlış anahtar metadatası ve ilgisiz bildirimde sahte ödeme üretmeme kapsamı var. Yayımlanacak kaynakta tam doğrulama geçti: **248 uygulama + 13 sözleşme testi**, tüm lint, TypeScript dahil üretim derlemesi ve `git diff --check`. Canlı arayüz kabulü ayrı bir adım olarak duruyor.

İlk canlı denemede özel depodan gelen `weak` HTTP sürüm etiketi koşullu güncellemeyi durdurdu. Sağlayıcının asıl kayıt sürümüne bağlanan okuma düzeltildi; sürüm değişirse koruma hâlâ işlemi reddeder. Bu hata ve teşhis de saklandı. Düzeltme commit'i `c56a089` için GitHub run `36919978273`, job `110563299860`: **238 uygulama + 13 sözleşme testi**, lint, üretim derlemesi, eski mainnet deployment doğrulaması ve salt-okuma preflight tamamen geçti. Vercel başarılı. Kanıt: [collections-monitor-release.json](evidence/collections-monitor-release.json). Otomatik sağlayıcı zamanlaması aktif değildir; Google/Circle gerçek satın alma ve webhook kabulü de ayrı engeller olarak durmaktadır.

`42d9584` için doğrulama run `36907479345` ilk denemede yalnızca eski deployment makbuzunun geçici olarak bulunamaması nedeniyle durdu. Aynı kodla yeniden çalıştırılan job `110523348036` tamamen başarılıdır. Bu geçici eksik makbuz hatasına özel, 4 denemeyle sınırlı toplam 7 saniyelik bekleme eklendi; receipt, blok, adres, bytecode ve getter kontrolleri korunuyor. Yerel 208 uygulama + 13 sözleşme testi, lint ve üretim derlemesi geçti.

İlk yönetim konsolu denemesinde Google bu ortamda `Site Unavailable` verdi; Circle Console erişimi bu tarayıcıya reddetti. Agent o denemede ayar değiştirmedi. Sonrasında hesap sahibi Google callback iznini ekledi ve gerçek önizleme girişi ile Circle cüzdan okuması geçti; eski OAuth engeli artık açık değildir. Kısıtlı webhook aboneliği, canlı müşteri satın alma ve diğer kabul ölçütleri [CONFIGURATION_ACCEPTANCE.md](CONFIGURATION_ACCEPTANCE.md) içinde somutlaştırıldı. Gerçek satın alma, bildirim teslimi ve sürekli zamanlama doğrulanmadan sürümün tamamı bitti denmez.

Yeni şirket/müşteri sürümü için `/collections-demo/index.html` ürün turu ve 72 saniyelik İngilizce altyazılı ekran görüntüsü videosu hazırlandı. Video ilk üç sahnede simülasyonu, devamında daha önce tamamlanan gerçek iç test makbuzunu ve okuyucu sonucunu gösterir; canlı Google/Circle onayı kaydı değildir. Kaynak ekran görüntüleri ve kapsam kaydı GitHub’dadır. Ayrıntı: [COLLECTIONS_DEMO.md](COLLECTIONS_DEMO.md).

Uygulama commit’i `fd72e54` için run `36911279409`, job `110534241970` tamamen geçti: 208 uygulama + 13 sözleşme testi, lint, derleme, mainnet deployment doğrulaması ve salt-okuma ağ kontrolü. Vercel başarılı; canlı ürün turu tarayıcıda kontrol edildi, makbuz görseli yüklendi ve sayfada yatay taşma yok. HTML, kanıt JSON'u, 72 saniyelik video ve altyazı dosyası HTTP 200 ile yayımlandı; yerel dosyalarla byte byte eşleşti. Kanıt: [collections-release-acceptance.json](evidence/collections-release-acceptance.json), [canlı ürün turu](evidence/collections-tour.jpg). Son görsel kontrolde müşteri sayfasının alt etiketi, mevcut cüzdanla ödeme sonucunu da doğru tanımlayacak şekilde genel USDC/Arc ifadesine düzeltildi.

## Yeni düğmenin yayın kanıtı

`39d1223` için GitHub run [36934507173](https://github.com/Mabolla/arc-paylink/actions/runs/36934507173), job `110611488312`, tüm doğrulama adımlarında başarılı; Vercel yayını başarılı. Canlı sandbox yeni **Check now** düğmesini, simülasyon etiketiyle devre dışı gösteriyor. Gerçek owner HTTP akışında iki tamamlanmış tarama daha geçti: kalıcı makbuz 1, tahsilat 0,01 USDC, açık bakiye 0, yeni makbuz 0. Agent aynı raporu gördü; geçici anahtar iptal edildi ve sonraki erişim 401 oldu. Yeni transfer yapılmadı.

Gerçek owner tarayıcısında şirket oturumu yoktu; güvenli giriş gerektiren düğme tıklaması yapılmış sayılmadı ve kullanıcıya yeni giriş isteği gönderilmedi. [Doğrulama özeti](evidence/collections-check-now-validation.json), [canlı API kabulü](evidence/collections-check-now-hosted.json), [etiketli sandbox ekranı](evidence/collections-check-now-sandbox.jpg). Orijinal main commit’i hâlâ `e82173d7580f1698f503d544202b986c143fd2a9`.

Anahtarı GitHub’da mevcut proje cüzdanı, yeni kaynakta makbuz kontrolüyle yeniden doğrulandı: run [36935708985](https://github.com/Mabolla/arc-paylink/actions/runs/36935708985), job `110615346442`, başarılı. Çalıştırma `confirm` modundaydı; cüzdan eşleşti, nonce 6, sipariş zaten ödenmiş ve eski işlem hash’i korundu. Yeni transfer **0**. Aynı kaynak için tam doğrulama run [36935713582](https://github.com/Mabolla/arc-paylink/actions/runs/36935713582), job `110615361053`, başarılı; Vercel başarılı. [Kanıt](evidence/collections-existing-key-recheck.json). Bu sonuç Google/Circle cüzdanından yapılmış bir ödeme değildir.

## Kesinti sonrası ödeme ekranı

Geçici ilk sipariş okuma hatasından sonra başarılı sonraki okuma Google giriş düğmesini geri getiriyor; önceki okuma hatası temizlenirken ödeme/SDK hataları ve devam eden onay aşamaları korunuyor. Canlı checkout, demo ve OAuth dönüş ekranında bileşen sipariş kimliğiyle yeniden kuruluyor; eski siparişin onay durumu yeni siparişe taşınmıyor. Onay kimliği kaydedilememiş ve 23 saatten eski denemede hazırlama ve kurtarma artık aynı işletme incelemesine yönlendiriyor; yeni transfer başlatma yasağı korunuyor.

Tam yerel doğrulama yeniden geçti: **248 uygulama + 13 sözleşme**, lint ve TypeScript dahil üretim derlemesi. Gerçek bileşen kodu üzerinde **15 mock checkout kontrolü** geçici ilk hata, gecikmiş hata, aktif onay/kurtarma aşamaları, ödeme hatası, ödenmiş/iptal sipariş ve üç çağırıcının sipariş bağını doğruladı. Bu kontroller para, kimlik bilgisi veya gerçek giriş kullanmadı. [Kanıt kapsamı](evidence/collections-checkout-recovery-validation.json).

Owner-only `GET /api/business/checkout-health`, mevcut sunucu anahtarını dışarı çıkarmadan bu yayına ait etkin Circle outbound aboneliğini kontrol ediyor. Yalnız hazırlık boolean’ları ve zaman damgası dönüyor; okuyucu erişimi reddediliyor, eksik anahtar/provider hatası başarı sayılmıyor. Bu eklemeden sonra **270 uygulama + 13 sözleşme testi**, tüm lint, üretim derlemesi ve sağlayıcı okuma mock kontrolü geçti. Yayın sonrası canlı readiness çağrısı ve GitHub’daki mevcut sağlayıcı erişimlerinin salt-okuma tanısı tamamlandı; ayrı sonuçları aşağıda kayıtlıdır. Sağlayıcı izni, para veya eski üretim değişikliği yapılmadı.

## Sunucudan doğrulanan Circle aboneliği

`20e61cf` yayınına gerçek owner readiness çağrısı HTTP 200 döndü: gömülü cüzdan ayarları hazır ve tam bu yayının callback adresine ait etkin outbound aboneliği var. Aboneliğin etkinliği artık yalnız kullanıcı bildirimi değil, sunucunun gerçek Circle metadata okumasıyla doğrulandı. Abonelik kimliği dışarı çıkarılmadı; gerçek ödenmiş sipariş bildirimi/replay hâlâ ayrı kabul adımı. Yeni transfer ve sağlayıcı değişikliği **0**. [Canlı readiness kanıtı](evidence/collections-circle-readiness.json).

Ayrı GitHub sağlayıcı kontrolünde kayıtlı Circle anahtarı vardı fakat HTTP 401 aldı; Vercel yönetim tokenı yoktu. Çalışan sunucu anahtarının durumu bundan ayrıdır. Vercel yönetim sayfası da runtime zaman aşımıyla okunamadı. Otomatik zamanlama açılmış sayılmadı. [Erişim kanıtı](evidence/collections-provider-access.json).

Son kaynak için GitHub run [36939330362](https://github.com/Mabolla/arc-paylink/actions/runs/36939330362), job `110626897319`, **270 uygulama + 13 sözleşme**, lint, derleme ve mainnet salt-okuma/deployment kontrollerinde tamamen başarılı. Vercel yayını başarılı; main hâlâ orijinal `e82173d7580f1698f503d544202b986c143fd2a9`. Microgrants güncelleme metni [hazırlandı](MICROGRANTS_UPGRADE_DRAFT.md); dış başvuru düzenlenmedi/gönderilmedi.

## Ayrı takip projesinin kurulması — 3 Ekim

Vercel yönetim ekranı bu devam çalışmasında erişilebilir oldu. `arc-paylink-collections-monitor` adlı ayrı proje kuruldu; üretim dalı yalnız `deploy/collections-monitor`, kaynak `82faa61`. Mainnet ayarlı son dağıtım Ready. Günlük `/api/cron/collections` görevi `0 5 * * *` UTC ile Vercel'de kayıtlıdır; özel depo, şirkete ait okuyucu ve ayrı cron secret henüz bağlanmadığı için görev duraklatıldı. Yetkisiz gerçek HTTP kontrolü 503 ve yapılandırma eksik yanıtı verdi. Başarılı görev çalıştırması veya otomatik tahsilat kabulü yapılmış sayılmadı.

Yeni projeye `arc-paylink-blob` okuma/yazma erişimi verecek bağlantı ekranı hazır; erişim değişikliği henüz onaylanmadı ve uygulanmadı. Eski proje, ana dal ve canlı üretim korunuyor. Yeni transfer **0**. Google/Circle gerçek satın alma/bildirim ve gerçek owner oturumunda düğme kontrolü hâlâ ayrı kabul adımlarıdır. [Kurulum kanıtı](evidence/collections-monitor-provisioning.json).
