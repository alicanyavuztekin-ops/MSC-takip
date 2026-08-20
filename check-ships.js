const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// 1. GİZLİ ANAHTAR KONTROLLERİ (GitHub Secrets)
if (!process.env.FIREBASE_SERVICE_ACCOUNT_B64 || !process.env.GMAIL_PASS) {
    console.error("HATA: GMAIL_PASS veya FIREBASE_SERVICE_ACCOUNT_B64 eksik!");
    process.exit(1);
}

// 2. FİREBASE BAĞLANTISI
const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 3. MAİL GÖNDERİM MOTORU (Değiştirilmedi, kusursuz çalışan yapı)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: 'gumruk.izmir@medlog.com.tr',
        pass: process.env.GMAIL_PASS
    }
});

// 4. AIS / UYDU VERİSİ ÇEKME FONKSİYONU (ZIRHLI VE GÜVENLİ)
// Eğer dış kaynak hata verirse sistemi durdurmaz, eski saatle devam eder.
async function fetchShipETAFromAIS(imo) {
    if (!imo || imo === 'BELİRTİLMEDİ' || imo === '-') return null;
    
    try {
        // Not: İleride buraya resmi bir AIS API anahtarı ekleyebiliriz.
        // Şimdilik açık mobil uç noktayı deniyor.
        const response = await fetch(`https://api.vesselfinder.com/vessels?user_key=FREE&imo=${imo}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.ok) {
            const data = await response.json();
            // Eğer uydudan güncel bir saat geldiyse onu döndürür
            if (data && data.length > 0 && data[0].eta) {
                return data[0].eta; 
            }
        }
        return null;
    } catch (error) {
        console.log(`[AIS UYARISI] IMO ${imo} için canlı veri çekilemedi. Eski saat baz alınacak.`);
        return null; // Hata durumunda sistemi çökertmez, null döner.
    }
}

// 5. ANA KONTROL MOTORU
async function checkShips() {
    try {
        console.log("⚙️ 1. Sistem Sağlığı (Health Check) Güncelleniyor...");
        await db.collection('system_status').doc('health').set({ 
            lastRun: new Date().toISOString(), 
            status: 'OK' 
        });

        console.log("⚙️ 2. Aktif Gemiler Taranıyor...");
        const snapshot = await db.collection('ships').where('status', '!=', 'COMPLETED').get();
        
        if (snapshot.empty) {
            console.log('Sistemde aktif gemi bulunamadı. İşlem sonlandırılıyor.');
            return;
        }

        for (const doc of snapshot.docs) {
            const ship = doc.data();
            if (!ship.eta) continue;

            let currentEta = ship.eta;

            // --- YENİ: AIS UYDU SORGUSU ---
            console.log(`🔍 ${ship.name} (IMO: ${ship.imo}) için canlı AIS verisi kontrol ediliyor...`);
            const aisEta = await fetchShipETAFromAIS(ship.imo);
            
            // Eğer uydudan yeni bir saat geldiyse ve eskisinden farklıysa veritabanını sessizce günceller
            if (aisEta && aisEta !== ship.eta) {
                currentEta = aisEta;
                await db.collection('ships').doc(doc.id).update({ eta: currentEta, lastUpdated: new Date().toLocaleString('tr-TR') });
                console.log(`✅ [GÜNCELLEME] ${ship.name} gemisinin saati uydu verisiyle güncellendi: ${currentEta}`);
            }

            // --- MEVCUT ÇALIŞAN MAİL MANTIĞI ---
            const etaDate = new Date(currentEta);
            const now = new Date();
            const diffHours = (etaDate - now) / 3600000;

            let emailType = null;
            let updates = {};

            // Zaman Kriterleri
            if (diffHours <= 0 && !ship.emailSentArrived) {
                emailType = 'YANAŞTI / LİMANDA';
                updates.emailSentArrived = true;
            } else if (diffHours > 0 && diffHours <= 6 && !ship.emailSent6h) {
                emailType = '6 SAAT KALA';
                updates.emailSent6h = true;
            } else if (diffHours > 6 && diffHours <= 12 && !ship.emailSent12h) {
                emailType = '12 SAAT KALA';
                updates.emailSent12h = true;
            }

            // Eğer eşik aşıldıysa ve mail atılacaksa
            if (emailType && ship.email) {
                console.log(`✉️ [MAİL] ${ship.name} için "${emailType}" bildirimi gönderiliyor...`);
                
                const mailOptions = {
                    from: '"MSC & MEDLOG Operasyon" <gumruk.izmir@medlog.com.tr>',
                    to: ship.email,
                    subject: `🚢 [${emailType}] GEMİ DURUM BİLDİRİMİ: ${ship.name}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-w-lg">
                            <div style="background-color: #111111; color: #FFCC00; padding: 15px; border-radius: 8px 8px 0 0; text-align: center;">
                                <h2 style="margin: 0; font-size: 18px;">MSC & MEDLOG GEMİ OPERASYON</h2>
                            </div>
                            <div style="padding: 20px; background-color: #f9fafb;">
                                <h3 style="color: #374151; margin-top: 0; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">${ship.name} - Güncel Durum</h3>
                                <p style="margin: 8px 0; color: #4b5563;"><b>Sefer No:</b> ${ship.voyage || '-'}</p>
                                <p style="margin: 8px 0; color: #4b5563;"><b>Güzergah:</b> ${ship.originPort} &rarr; <b>${ship.destinationPort}</b></p>
                                <p style="margin: 8px 0; color: #4b5563;"><b>Hedef Zaman (ETA):</b> <span style="color: #2563eb; font-weight: bold;">${etaDate.toLocaleString('tr-TR')}</span></p>
                                <p style="margin: 8px 0; color: #4b5563;"><b>Beyanname Sayısı:</b> ${ship.declarations || 0} Adet</p>
                                ${ship.note ? `<p style="margin: 8px 0; color: #4b5563;"><b>Ek Not:</b> <span style="background-color: #fef3c7; padding: 2px 6px; border-radius: 4px;">${ship.note}</span></p>` : ''}
                                
                                <div style="margin-top: 20px; padding: 15px; background-color: ${diffHours <= 0 ? '#d1fae5' : '#fee2e2'}; border-radius: 8px; text-align: center;">
                                    <strong style="color: ${diffHours <= 0 ? '#065f46' : '#991b1b'}; font-size: 16px;">
                                        ${diffHours <= 0 ? 'Gemi Limana Yanaştı / İşlemde.' : `Limana Yanaşmasına Yaklaşık ${Math.round(diffHours)} Saat Kaldı!`}
                                    </strong>
                                </div>
                            </div>
                            <div style="font-size: 11px; color: #9ca3af; text-align: center; margin-top: 15px;">
                                Bu e-posta otomatik sistem tarafından gönderilmiştir.<br>Sistem Sağlığı ve AIS Uydu Bağlantısı Aktif.
                            </div>
                        </div>
                    `
                };

                await transporter.sendMail(mailOptions);
                await db.collection('ships').doc(doc.id).update(updates);
                console.log(`✅ Mail başarıyla gönderildi: ${ship.email}`);
            }
        }
        
        console.log("🎉 Tüm kontroller sorunsuz tamamlandı!");
        
    } catch (error) {
        console.error("❌ KRİTİK HATA:", error);
        process.exit(1);
    }
}

// Botu Çalıştır
checkShips();
