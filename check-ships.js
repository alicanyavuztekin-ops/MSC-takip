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
    console.log("Zaman kontrolü başlıyor (Site Linkli HTML Sistem)...");
    const now = new Date();

    try {
        // --- KARŞILIKLI SAĞLIK KONTROLÜ (HEARTBEAT) ---
        const healthRef = db.collection('system').doc('health');
        await healthRef.set({ checkShipsLastRun: now.toISOString() }, { merge: true });

        const healthDoc = await healthRef.get();
        const health = healthDoc.exists ? healthDoc.data() : {};
        const otonomLast = health.otonomBotLastRun ? new Date(health.otonomBotLastRun) : null;
        const otonomStaleMinutes = otonomLast ? (now - otonomLast) / 60000 : null;

        if (otonomStaleMinutes !== null && otonomStaleMinutes > 40) {
            if (!health.otonomBotAlertSent) {
                const alertTo = process.env.PANEL_EMAIL;
                if (alertTo) {
                    await transporter.sendMail({
                        from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: alertTo,
                        subject: '⚠️ UYARI: Otonom ETA Botu çalışmıyor olabilir',
                        html: `<div style="font-family: Arial, sans-serif; color: #333;"><p>Otonom ETA Botu, beklenenden uzun süredir Firestore'a ulaşmadı (son görülme: ${otonomLast ? otonomLast.toLocaleString('tr-TR') : 'hiç çalışmamış'}).</p><p>GitHub → Actions → "Tam Otonom ETA Botu" sekmesini kontrol edin.</p></div>`
                    });
                    console.log("UYARI: Otonom bot gecikmesi maili gönderildi.");
                }
                await healthRef.set({ otonomBotAlertSent: true }, { merge: true });
            }
        } else if (health.otonomBotAlertSent) {
            await healthRef.set({ otonomBotAlertSent: false }, { merge: true });
            console.log("Otonom bot toparlandı, uyarı bayrağı sıfırlandı.");
        }

        // --- YENİ KAYIT BİLDİRİMİ ---
        const newRegsSnap = await db.collection('newRegistrations').where('notified', '==', false).get();
        const ownerEmail = process.env.PANEL_EMAIL;
        if (!newRegsSnap.empty && ownerEmail) {
            for (const regDoc of newRegsSnap.docs) {
                const reg = regDoc.data();
                await transporter.sendMail({
                    from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: ownerEmail,
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

        for (const doc of snapshot.docs) {
            const ship = doc.data();
            const eta = new Date(ship.eta);
            const email = ship.email;

            if (isNaN(eta.getTime()) || !email) {
                console.log(`ATLANDI: ${ship.name || doc.id} -> ${isNaN(eta.getTime()) ? `ETA okunamadı (kayıtlı değer: "${ship.eta}")` : ''}${(isNaN(eta.getTime()) && !email) ? ' ve ' : ''}${!email ? 'mail adresi boş' : ''}`);
                continue;
            }
            
            const diffMs = eta - now;
            const diffHours = diffMs / (1000 * 60 * 60);
            console.log(`Kontrol: ${ship.name} | ETA'ya kalan: ${diffHours.toFixed(1)} saat | emailSentNew: ${!!ship.emailSentNew} | emailSent10h: ${!!ship.emailSent10h} | emailSent5h: ${!!ship.emailSent5h}`);
            
            let updateData = {};
            let shouldUpdate = false;
            let mailSubject = "";
            let mailHtml = "";

            // --- SİTE LİNKİ VE BUTON ŞABLONU ---
            const siteLink = ship.siteUrl || "https://alicanyavuztekin-ops.github.io"; 
            const buttonHtml = `<br><br><a href="${siteLink}" style="background-color: #111111; color: #FFCC00; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-family: Arial, sans-serif; font-size: 14px;">👉 SİSTEME GİRİŞ YAP</a>`;

            // YENİ EKLENDİ MAİLİ
            if (!ship.emailSentNew) {
                mailSubject = `🚢 YENİ GEMİ EKLENDİ: ${ship.name} (SEFER: ${ship.voyage || '-'})`;
                mailHtml = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h3 style="color: #111111;">Yeni gemi operasyon listesine eklendi!</h3>
                        <p><b>Gemi:</b> ${ship.name}</p>
                        <p><b>IMO:</b> ${ship.imo}</p>
                        <p><b>Geldiği Liman:</b> ${ship.originPort || '-'}</p>
                        <p><b>Varış Limanı:</b> ${ship.destinationPort || '-'}</p>
                        <p><b>ETA:</b> ${new Date(ship.eta).toLocaleString('tr-TR')}</p>
                        <p><b>Beyanname:</b> ${ship.declarations || '0'} Adet</p>
                        <p><b>Not:</b> ${ship.note || '-'}</p>
                        ${buttonHtml}
                    </div>
                `;
                
                await transporter.sendMail({ from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: email, subject: mailSubject, html: mailHtml });
                console.log(`${ship.name} için YENİ GEMİ maili atıldı.`);
                updateData.emailSentNew = true;
                shouldUpdate = true;
            }

            // 10 SAAT UYARISI MAİLİ
            if (diffHours > 0 && diffHours <= 10 && !ship.emailSent10h && (updateData.emailSentNew || ship.emailSentNew)) {
                mailSubject = `🚨 UYARI: ${ship.name} VARIŞA 10 SAAT KALA!`;
                mailHtml = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h3 style="color: #e65100;">10 SAAT UYARISI</h3>
                        <p><b>${ship.name}</b> isimli geminin limana tahmini varışına 10 saat veya daha az bir süre kalmıştır.</p>
                        <p>Gümrük ve beyanname işlemlerini kontrol ediniz.</p>
                        ${buttonHtml}
                    </div>
                `;
                
                await transporter.sendMail({ from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: email, subject: mailSubject, html: mailHtml });
                console.log(`${ship.name} için 10 SAAT maili atıldı.`);
                updateData.emailSent10h = true;
                shouldUpdate = true;
            }

            // 5 SAAT UYARISI MAİLİ
            if (diffHours > 0 && diffHours <= 5 && !ship.emailSent5h && (updateData.emailSent10h || ship.emailSent10h)) {
                mailSubject = `🔴 KRİTİK UYARI: ${ship.name} VARIŞA 5 SAAT KALA!`;
                mailHtml = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h3 style="color: #d32f2f;">KRİTİK 5 SAAT UYARISI</h3>
                        <p><b>${ship.name}</b> isimli geminin limana tahmini varışına 5 saatten az kalmıştır!</p>
                        <p>Lütfen gümrük durumunu acilen teyit ediniz.</p>
                        ${buttonHtml}
                    </div>
                `;
                
                await transporter.sendMail({ from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: email, subject: mailSubject, html: mailHtml });
                console.log(`${ship.name} için 5 SAAT maili atıldı.`);
                updateData.emailSent5h = true;
                shouldUpdate = true;
            }

            if (shouldUpdate) {
                await shipsRef.doc(doc.id).update(updateData);
            }
        }
        
        console.log("Görev başarıyla tamamlandı.");
    } catch (error) {
        console.error("HATA OLUŞTU:", error);
    }
}

checkShips();
