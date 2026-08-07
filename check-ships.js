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
        user: 'mscgemitakip@gmail.com', // Kendi sistem mailin
        pass: GMAIL_PASS
    }
});

// 4. ANA KONTROL DÖNGÜSÜ (Manuel ETA'ya göre çalışır)
async function checkShips() {
    console.log("Zaman kontrolü başlıyor (Orijinal Stabil Sistem)...");
    const now = new Date();

    try {
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

            // Tarih geçersizse veya mail yoksa bu gemiyi atla
            if (isNaN(eta.getTime()) || !email) continue;
            
            const diffMs = eta - now;
            const diffHours = diffMs / (1000 * 60 * 60);
            
            let updateData = {};
            let shouldUpdate = false;
            let mailSubject = "";
            let mailText = "";

            // Yeni Eklendi Maili
            if (!ship.emailSentNew) {
                mailSubject = `🚢 YENİ GEMİ EKLENDİ: ${ship.name} (SEFER: ${ship.voyage})`;
                mailText = `Yeni gemi operasyon listesine eklendi!\n\nGemi: ${ship.name}\nIMO: ${ship.imo}\nGeldiği Liman: ${ship.originPort}\nVarış Limanı: ${ship.destinationPort}\nETA: ${new Date(ship.eta).toLocaleString('tr-TR')}\nBeyanname: ${ship.declarations} Adet\nNot: ${ship.note || '-'}`;
                
                await transporter.sendMail({ from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: email, subject: mailSubject, text: mailText });
                console.log(`${ship.name} için YENİ GEMİ maili atıldı.`);
                updateData.emailSentNew = true;
                shouldUpdate = true;
            }

            // 10 Saat Uyarısı
            if (diffHours > 0 && diffHours <= 10 && !ship.emailSent10h && (updateData.emailSentNew || ship.emailSentNew)) {
                mailSubject = `🚨 UYARI: ${ship.name} VARIŞA 10 SAAT KALA!`;
                mailText = `10 SAAT UYARISI:\n\n${ship.name} isimli geminin ${ship.destinationPort} limanına tahmini varışına 10 saat veya daha az bir süre kalmıştır. Gümrük ve beyanname (${ship.declarations} adet) işlemlerini kontrol ediniz.`;
                
                await transporter.sendMail({ from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: email, subject: mailSubject, text: mailText });
                console.log(`${ship.name} için 10 SAAT maili atıldı.`);
                updateData.emailSent10h = true;
                shouldUpdate = true;
            }

            // 5 Saat Uyarısı
            if (diffHours > 0 && diffHours <= 5 && !ship.emailSent5h && (updateData.emailSent10h || ship.emailSent10h)) {
                mailSubject = `🔴 KRİTİK UYARI: ${ship.name} VARIŞA 5 SAAT KALA!`;
                mailText = `KRİTİK 5 SAAT UYARISI:\n\n${ship.name} isimli geminin ${ship.destinationPort} limanına tahmini varışına 5 saatten az kalmıştır! Lütfen gümrük durumunu acilen teyit ediniz.`;
                
                await transporter.sendMail({ from: '"MSC & MEDLOG TAKİP" <mscgemitakip@gmail.com>', to: email, subject: mailSubject, text: mailText });
                console.log(`${ship.name} için 5 SAAT maili atıldı.`);
                updateData.emailSent5h = true;
                shouldUpdate = true;
            }

            if (shouldUpdate) {
                await shipsRef.doc(doc.id).update(updateData);
            }
        }
        
        console.log("Görev başarıyla tamamlandı.");
