# HUGAR Finans Merkezi — İnternette Yayınlama

Bu paket yüklenen `hugar.zip` dosyasındaki **çalışan uygulama kaynak kodlarını değiştirmeden** hazırlanmıştır. Veritabanı SQL dosyaları referans içindir; **yeniden çalıştırmayın**. Mevcut Supabase projesini değiştirmeyin.

## 1. Ön hazırlık
- Supabase projesinin veritabanı yedeğini alın.
- Supabase Dashboard > Project Settings > API bölümünden proje URL'sini ve **publishable / anon** anahtarını kendi hesabınızdan alın. Anahtarları kimseye göndermeyin.
- **service_role / secret key** tarayıcıya, GitHub'a veya `NEXT_PUBLIC_` isimli değişkene konmamalıdır.
- Supabase SQL Editor üzerinden mevcut RLS, RPC EXECUTE izinleri ve `finance_user_roles` kurallarını canlıya çıkmadan önce denetleyin. Bu paket canlı veritabanı güvenliğini otomatik olarak doğrulamaz.

## 2. GitHub ve Vercel
1. GitHub'da **Private** yeni bir repository oluşturun (ör. `hugar-finans`).
2. Bu paketin kökündeki dosyaları repository'ye ekleyin; `.env.local`, `.env*` gerçek sırlar, `node_modules`, `.next`, `*.zip` dosyalarını eklemeyin. `.env.example` örnek dosyadır.
3. Vercel > Add New > Project > Import Git Repository üzerinden private repository'yi seçin.
4. Framework: Next.js. Root Directory: repository kökü. Build Command: `npm run build` (varsayılan). 
5. Vercel > Project > Settings > Environment Variables bölümüne şu iki değeri girin:
   - `NEXT_PUBLIC_SUPABASE_URL`: mevcut Supabase projesinin URL'si
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: mevcut Supabase publishable/anon anahtarı
6. Deploy yapın. Verilen `https://...vercel.app` adresinden farklı cihaz ve mobil veriyle deneyin.

## 3. Canlıya almadan önce kontrol
- `sabri` ve `iso` ile ayrı ayrı oturum açma, doğru yetki ve kayıtların görünürlüğü.
- Tamamlanmış görevi iptal etme yalnızca Sabri'de; iptal sonrası borç, ödeme ve giderlerin yeniden hesaplanması.
- 4 grup, gelir/gider toplamları, market cari borçları, fatura ve görev akışı.
- Mobil ekranlarda menü, form ve tablo kullanımı.
- Supabase RLS politikaları, fonksiyon izinleri, şifre sıfırlama, yedekleme ve erişim kayıtları.

## 4. Önemli notlar
- PIN ekran kilidi yalnızca o tarayıcıda kayıtlıdır; yeni cihazda kullanıcı adı ve şifreyle giriş yapılır.
- `app/api/pin-login` ve `app/api/pin-setup` sunucu uçları 501 döndürür; mevcut istemci tarafı PIN kilidiyle karıştırmayın.
- Mevcut uygulamada `sabri` ve `iso` kullanıcı adları e-posta kimliklerine kod içinde eşlenmiş. Yeni kullanıcı eklemek yalnızca Supabase'de kullanıcı oluşturmakla tamamlanmayabilir; ayrıca giriş eşleştirmesi ve yetki yapılandırması gerekir.
- Bu paket uygulamanın canlıya alındığı veya güvenlik testlerinin tamamlandığı anlamına gelmez. Paket kaynak kodu değişmeden hazırlanmıştır; bu ortamda bağımlılık kurulumu ve üretim derlemesi tamamlanamamıştır.
- Üretim ortamına geçmeden önce GitHub/Vercel üzerinde build sonucunu kontrol edin. 
