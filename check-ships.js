const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// 1. GİZLİ ŞİFRELERİ VE KİMLİKLERİ AL
const GMAIL_PASS = process.env.GMAIL_PASS;
const FIREBASE_B64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;

if (!GMAIL_PASS || !FIREBASE_B64) {
    console.error("HATA: Çevre değişkenleri (GMAIL_PASS veya FIREBASE_B64) eksik!");
    process.exit(1);
}

// 2. FIREBASE BAĞLANTISINI KUR
const serviceAccount = JSON.parse(Buffer.from(FIREBASE_B64, 'base64').toString('utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// 3. MAİL MOTORUNU KUR
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'mscgemitakip@gmail.com',
        pass: GMAIL_PASS
    }
});

// 4. ANA KONTROL DÖNGÜSÜ
async function checkShips() {
    console.log("Zaman kontrolü başlıyor (Kurumsal Tasarımlı Sistem)...");
    
    // GITHUB SUNUCUSU AMERİKA'DA BİLE OLSA TÜRKİYE SAATİNİ (UTC+3) BUL
    const nowUTC = new Date();
    const nowTR = new Date(nowUTC.getTime() + (3 * 60 * 60 * 1000));

    try {
        // --- YENİ KAYIT BİLDİRİMİ ---
        const newRegsSnap = await db.collection('newRegistrations').where('notified', '==', false).get();
        const ownerEmail = process.env.PANEL_EMAIL;
        if (!newRegsSnap.empty && ownerEmail) {
            for (const regDoc of newRegsSnap.docs) {
                const reg = regDoc.data();
                await transporter.sendMail({
                    from: '"MSC & MEDLOG OPERASYON" <mscgemitakip@gmail.com>', to: ownerEmail,
                    subject: '👤 Yeni Kullanıcı Kaydoldu',
                    html: `<div style="font-family: Arial, sans-serif; color: #333;"><p>Sisteme yeni bir kullanıcı kaydoldu:</p><p><b>E-posta:</b> ${reg.email}</p><p><b>Tarih:</b> ${reg.registeredAt || '-'}</p></div>`
                });
                await regDoc.ref.update({ notified: true });
                console.log(`Yeni kayıt maili gönderildi: ${reg.email}`);
            }
        }

        const shipsRef = db.collection('ships');
        const snapshot = await shipsRef.where('status', '==', 'PENDING').get();

        if (snapshot.empty) {
            console.log("Bekleyen gemi bulunamadı.");
            return;
        }

        let islemYapilanGemiSayisi = 0;

        for (const doc of snapshot.docs) {
            const ship = doc.data();
            const email = ship.email;
            const etaDate = new Date(ship.eta);

            // Boş veya hatalı kayıtları atla
            if (isNaN(etaDate.getTime()) || !email) continue;
            
            // TÜRKİYE SAATİNE GÖRE FARK HESAPLAMA
            const diffMs = etaDate.getTime() - nowTR.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            
            let updates = {};
            let emailSubject = "";
            let emailTitle = "";
            let emailColor = "";

            // --- MAİL TETİKLEME MANTIĞI ---
            
            // 1. YENİ GEMİ EKLENDİ BİLDİRİMİ
            if (!ship.emailSentNew) {
              emailSubject = `YENİ GEMİ BİLDİRİMİ: ${ship.name || 'İSİMSİZ'} - ${ship.voyage || '-'}`;
              emailTitle = "YENİ GEMİ OPERASYON BİLDİRİMİ";
              emailColor = "#2563eb"; // Kurumsal Mavi
              updates.emailSentNew = true;
            } 
            // 2. LİMANDA (YANAŞTI) BİLDİRİMİ
            else if (diffHours <= 0 && !ship.emailSentArrived) {
              emailSubject = `LİMANDA: ${ship.name} YANAŞTI`;
              emailTitle = "GEMİ LİMANA YANAŞTI";
              emailColor = "#16a34a"; // Başarı Yeşili
              updates.emailSentArrived = true;
            }
            // 3. 6 SAAT KALA BİLDİRİMİ
            else if (diffHours > 0 && diffHours <= 6 && !ship.emailSent6h) {
              emailSubject = `KRİTİK UYARI - 6 SAAT: ${ship.name}`;
              emailTitle = "LİMANDA OLMASINA 6 SAAT KALDI";
              emailColor = "#dc2626"; // Kritik Kırmızı
              updates.emailSent6h = true;
            }
            // 4. 12 SAAT KALA BİLDİRİMİ
            else if (diffHours > 6 && diffHours <= 12 && !ship.emailSent12h) {
              emailSubject = `YAKLAŞIYOR - 12 SAAT: ${ship.name}`;
              emailTitle = "LİMANDA OLMASINA 12 SAAT KALDI";
              emailColor = "#ea580c"; // Uyarı Turuncusu
              updates.emailSent12h = true;
            }

            // EĞER ATILACAK MAİL VARSA GÖNDER
            if (Object.keys(updates).length > 0 && email) {
                
                console.log(`[İŞLEM BAŞLIYOR] Gemi: ${ship.name} | ETA'ya kalan: ${diffHours.toFixed(1)} saat`);
                
                // HT Beyannamelerini HTML Liste Haline Getir
                let htListHtml = "";
                if (ship.htDeclarations && ship.htDeclarations.length > 0) {
                    const htItems = ship.htDeclarations.map(ht => 
                    `<li style="margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"><strong>${ht.no}</strong> ${ht.note ? `<span style="color:#64748b; font-size:11px; float: right;">(${ht.note})</span>` : ''}</li>`
                    ).join('');
                    
                    htListHtml = `
                    <div style="margin-top: 20px; padding: 15px; background-color: #f8fafc; border-left: 4px solid #FFCC00; border-radius: 4px;">
                        <h4 style="margin: 0 0 10px 0; color: #111111; font-size: 14px; text-transform: uppercase;">Girilen HT Beyannameleri (${ship.htDeclarations.length} Adet):</h4>
                        <ul style="margin: 0; padding-left: 0; list-style-type: none; font-size: 13px; color: #0f172a;">
                        ${htItems}
                        </ul>
                    </div>
                    `;
                } else {
                    htListHtml = `<div style="margin-top: 20px; padding: 12px; background-color: #fffbeb; border: 1px dashed #fcd34d; border-radius: 4px;"><p style="font-size: 12px; color: #b45309; margin:0; text-align: center;"><em>Bu gemi için henüz HT Beyannamesi girilmemiştir.</em></p></div>`;
                }

                const siteLink = ship.siteUrl || "https://alicanyavuztekin-ops.github.io";

                // KURUMSAL TASARIMLI HTML MAİL ŞABLONU
                const htmlContent = `
                    <div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); background-color: #ffffff;">
                        
                        <!-- KURUMSAL HEADER (MSC & MEDLOG RENKLERİ) -->
                        <div style="background-color: #111111; padding: 25px 20px; text-align: center; border-bottom: 4px solid #FFCC00;">
                            <h1 style="margin: 0; color: #FFCC00; font-size: 26px; font-weight: 900; letter-spacing: 2px;">MSC <span style="color: #ffffff;">&amp;</span> MEDLOG</h1>
                            <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 11px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase;">Liman Operasyon Sistemİ</p>
                        </div>

                        <!-- DURUM BANDI -->
                        <div style="background-color: ${emailColor}; color: white; padding: 12px; text-align: center; font-weight: bold; font-size: 15px; letter-spacing: 1px;">
                            ${emailTitle}
                        </div>

                        <!-- İÇERİK BÖLÜMÜ -->
                        <div style="padding: 30px 25px; background-color: #ffffff;">
                            <p style="font-size: 14px; color: #334155; margin-top: 0;">Sayın İlgili,</p>
                            <p style="font-size: 14px; color: #475569; line-height: 1.5;">Operasyon sistemimizde kayıtlı olan aşağıdaki geminin güncel durum bilgisi tarafınıza sunulmuştur.</p>
                            
                            <table style="width: 100%; border-collapse: collapse; margin-top: 25px; border: 1px solid #e2e8f0; font-size: 13px;">
                                <tr>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; width: 35%; background-color: #f1f5f9; font-weight: bold; color: #475569;">GEMİ ADI</td>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #111111; font-size: 15px;">${ship.name}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; background-color: #f1f5f9; font-weight: bold; color: #475569;">SEFER NO</td>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${ship.voyage || '-'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; background-color: #f1f5f9; font-weight: bold; color: #475569;">IMO NO</td>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${ship.imo || '-'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; background-color: #f1f5f9; font-weight: bold; color: #475569;">GÜZERGAH</td>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${ship.originPort} &rarr; <strong>${ship.destinationPort}</strong></td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; background-color: #f1f5f9; font-weight: bold; color: #475569;">HEDEF ZAMAN</td>
                                    <td style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; color: #111111; font-weight: bold;">${etaDate.toLocaleString('tr-TR')}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 15px; border-right: 1px solid #e2e8f0; background-color: #f1f5f9; font-weight: bold; color: #475569;">EK NOT</td>
                                    <td style="padding: 12px 15px; color: #0f172a; font-style: italic;">${ship.note || '-'}</td>
                                </tr>
                            </table>

                            ${htListHtml}

                            <div style="text-align: center; margin-top: 35px; margin-bottom: 10px;">
                                <a href="${siteLink}" style="background-color: #111111; color: #FFCC00; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: bold; display: inline-block; border: 1px solid #000000;">SİSTEME GİT VE İŞLEM YAP</a>
                            </div>
                        </div>

                        <!-- KURUMSAL FOOTER -->
                        <div style="background-color: #f8fafc; color: #64748b; text-align: center; padding: 20px; font-size: 11px; line-height: 1.6; border-top: 1px solid #e2e8f0;">
                            <strong>Bu e-posta MSC & MEDLOG Otonom Operasyon Paneli tarafından oluşturulmuştur.</strong><br>
                            Lütfen bu e-postayı yanıtlamayınız. Sistemsel bir hata olduğunu düşünüyorsanız departman yöneticinizle iletişime geçiniz.<br>
                            &copy; ${new Date().getFullYear()} MSC & MEDLOG Tüm Hakları Saklıdır.
                        </div>
                    </div>
                `;

                try {
                    await transporter.sendMail({
                        from: `"MSC & MEDLOG Operasyon" <${process.env.EMAIL_USER || 'mscgemitakip@gmail.com'}>`,
                        to: email,
                        subject: emailSubject,
                        html: htmlContent
                    });
                    await shipsRef.doc(doc.id).update(updates);
                    console.log(`✅ Mail Başarıyla Gönderildi: ${ship.name} -> ${email}`);
                    islemYapilanGemiSayisi++;
                } catch (error) {
                    console.error(`❌ Mail Gönderme Hatası (${ship.name}):`, error);
                }
            }
        }
        
        if (islemYapilanGemiSayisi === 0) {
            console.log("Şu an mail atılacak yeni veya saati gelmiş kritik bir gemi yok.");
        }
        
        console.log("🏁 Mail botu taraması başarıyla tamamlandı.");
    } catch (error) {
        console.error("HATA OLUŞTU:", error);
    }
}

checkShips();
