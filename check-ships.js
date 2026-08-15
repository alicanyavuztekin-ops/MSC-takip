const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// 1. GİZLİ BİLGİLERİ AL
const GMAIL_PASS = process.env.GMAIL_PASS;
const FIREBASE_B64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;

if (!GMAIL_PASS || !FIREBASE_B64) {
    console.error("HATA: GMAIL_PASS veya FIREBASE_B64 eksik!");
    process.exit(1);
}

// 2. FIREBASE BAĞLANTISI
const serviceAccount = JSON.parse(Buffer.from(FIREBASE_B64, 'base64').toString('utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// 3. DOĞRUDAN GMAIL SMTP MOTORU (STANDART PORT 465)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: 'mscgemitakip@gmail.com',
        pass: GMAIL_PASS
    }
});

// 4. KONTROL VE GÖNDERİM MOTORU
async function checkShips() {
    console.log("Zaman kontrolü başlıyor (Grup Mail Uyumlu Mod)...");
    
    // Türkiye Saati (UTC+3)
    const nowUTC = new Date();
    const nowTR = new Date(nowUTC.getTime() + (3 * 60 * 60 * 1000));

    try {
        const shipsRef = db.collection('ships');
        const snapshot = await shipsRef.where('status', '==', 'PENDING').get();

        if (snapshot.empty) {
            console.log("Bekleyen gemi bulunamadı.");
            return;
        }

        let islemSayisi = 0;

        for (const doc of snapshot.docs) {
            const ship = doc.data();
            const emailField = ship.email;
            const etaDate = new Date(ship.eta);

            if (isNaN(etaDate.getTime()) || !emailField) continue;
            
            // Türkiye Saati ile Kalan Süre
            const diffMs = etaDate.getTime() - nowTR.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            
            let updates = {};
            let emailSubject = "";
            let emailTitle = "";
            let emailColor = "";

            // 1. Yeni Gemi Bildirimi
            if (!ship.emailSentNew) {
              emailSubject = `YENİ GEMİ: ${ship.name || 'İSİMSİZ'} - ${ship.voyage || '-'}`;
              emailTitle = "YENİ GEMİ OPERASYON BİLDİRİMİ";
              emailColor = "#2563eb";
              updates.emailSentNew = true;
            } 
            // 2. Limanda / Yanaştı
            else if (diffHours <= 0 && !ship.emailSentArrived) {
              emailSubject = `LİMANDA: ${ship.name} YANAŞTI`;
              emailTitle = "GEMİ LİMANA YANAŞTI";
              emailColor = "#16a34a";
              updates.emailSentArrived = true;
            }
            // 3. 6 Saat Kala
            else if (diffHours > 0 && diffHours <= 6 && !ship.emailSent6h) {
              emailSubject = `KRİTİK UYARI (6 SAAT): ${ship.name}`;
              emailTitle = "LİMANDA OLMASINA 6 SAAT KALDI";
              emailColor = "#dc2626";
              updates.emailSent6h = true;
            }
            // 4. 12 Saat Kala
            else if (diffHours > 6 && diffHours <= 12 && !ship.emailSent12h) {
              emailSubject = `YAKLAŞIYOR (12 SAAT): ${ship.name}`;
              emailTitle = "LİMANDA OLMASINA 12 SAAT KALDI";
              emailColor = "#ea580c";
              updates.emailSent12h = true;
            }

            if (Object.keys(updates).length > 0) {
                const siteLink = ship.siteUrl || "https://alicanyavuztekin-ops.github.io";
                const htList = ship.htDeclarations || [];
                
                // DÜZ METİN (Filtreleri aşmak için zorunlu)
                const htListText = htList.length > 0 
                    ? htList.map(h => `- ${h.no} ${h.note ? `(${h.note})` : ''}`).join('\n')
                    : 'Henüz HT Beyannamesi girilmedi.';

                const textContent = `
MSC & MEDLOG LİMAN OPERASYON BİLDİRİMİ
--------------------------------------
${emailTitle}

GEMİ ADI: ${ship.name}
SEFER NO: ${ship.voyage || '-'}
IMO NO: ${ship.imo || '-'}
GÜZERGAH: ${ship.originPort} -> ${ship.destinationPort}
HEDEF ZAMAN (ETA/ETB): ${etaDate.toLocaleString('tr-TR')}
EK NOT: ${ship.note || '-'}

GİRİLEN HT BEYANNAMELERİ (${htList.length} Adet):
${htListText}

Sisteme Giriş: ${siteLink}
                `.trim();

                // HTML GÖRSEL ŞABLON
                const htListHtml = htList.length > 0 
                    ? htList.map(h => `<li style="padding:4px 0; border-bottom:1px solid #eee;"><b>${h.no}</b> ${h.note ? `<span style="color:#666; font-size:11px;">(${h.note})</span>` : ''}</li>`).join('')
                    : '<li style="color:#888;">Henüz HT Beyannamesi girilmedi.</li>';

                const htmlContent = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 6px; overflow: hidden;">
                        <div style="background-color: #111; padding: 18px; text-align: center; border-bottom: 3px solid #FFCC00;">
                            <h2 style="margin: 0; color: #FFCC00; font-size: 20px;">MSC &amp; MEDLOG OPERASYON</h2>
                        </div>
                        <div style="background-color: ${emailColor}; color: #fff; padding: 10px; text-align: center; font-weight: bold; font-size: 14px;">
                            ${emailTitle}
                        </div>
                        <div style="padding: 20px;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; width: 35%; background: #f9f9f9;"><b>GEMİ ADI</b></td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${ship.name}</td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; background: #f9f9f9;"><b>SEFER NO</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${ship.voyage || '-'}</td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; background: #f9f9f9;"><b>IMO NO</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${ship.imo || '-'}</td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; background: #f9f9f9;"><b>GÜZERGAH</b></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${ship.originPort} &rarr; <b>${ship.destinationPort}</b></td></tr>
                                <tr><td style="padding: 8px; border-bottom: 1px solid #eee; background: #f9f9f9;"><b>HEDEF ZAMAN</b></td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${etaDate.toLocaleString('tr-TR')}</td></tr>
                                <tr><td style="padding: 8px; background: #f9f9f9;"><b>EK NOT</b></td><td style="padding: 8px;">${ship.note || '-'}</td></tr>
                            </table>

                            <div style="margin-top: 15px; padding: 12px; background: #fcfcfc; border: 1px solid #eee; border-radius: 4px;">
                                <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #333;">HT BEYANNAMELERİ (${htList.length} Adet):</h4>
                                <ul style="margin: 0; padding-left: 18px; font-size: 12px;">${htListHtml}</ul>
                            </div>

                            <div style="text-align: center; margin-top: 20px;">
                                <a href="${siteLink}" style="background-color: #111; color: #FFCC00; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: bold; display: inline-block;">Sisteme Git ve İşlem Yap</a>
                            </div>
                        </div>
                    </div>
                `;

                // Çoklu e-posta desteği (virgülle ayrılmışsa temizle)
                const cleanRecipients = emailField.split(',').map(e => e.trim()).filter(e => e.length > 0).join(', ');

                try {
                    await transporter.sendMail({
                        from: '"MSC & MEDLOG Operasyon" <mscgemitakip@gmail.com>',
                        replyTo: 'mscgemitakip@gmail.com',
                        to: cleanRecipients,
                        subject: emailSubject,
                        text: textContent, // Filtreleri aşan Düz Metin
                        html: htmlContent  // Renkli Görsel Şablon
                    });
                    
                    await shipsRef.doc(doc.id).update(updates);
                    console.log(`✅ Mail İletildi: ${ship.name} -> ${cleanRecipients}`);
                    islemSayisi++;
                } catch (error) {
                    console.error(`❌ Mail Hatası (${ship.name}):`, error);
                }
            }
        }
        
        console.log(`İşlem tamamlandı. Gönderilen: ${islemSayisi}`);
    } catch (error) {
        console.error("HATA:", error);
    }
}

checkShips();
