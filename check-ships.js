const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// 1. GİZLİ ŞİFRELERİ VE KİMLİKLERİ AL
const GMAIL_PASS = process.env.GMAIL_PASS;
const FIREBASE_B64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;

if (!GMAIL_PASS || !FIREBASE_B64) {
    console.error("HATA: Çevre değişkenleri (GMAIL_PASS veya FIREBASE_B64) eksik!");
    process.exit(1);
}

// 2. FİREBASE BAĞLANTISINI KUR
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

// 4. VIP MED FİLOSU (Sadece bu gemiler için ücretsiz veri aranacak)
const targetFleet = [
    "MED AYDIN", "MED ÇEŞME", "MED CESME", "MED URLA", 
    "MED BEYKOZ", "MED ÇERKEZKÖY", "MED CERKEZKOY", 
    "MED ANTALYA", "MED TRABZON", "MED ÇORLU", "MED CORLU", 
    "MED İZMİR", "MED IZMIR", "MED TEKİRDAĞ", "MED TEKIRDAG", 
    "MED MERSİN", "MED MERSIN", "MED DENİZ", "MED DENIZ"
];

// 5. ÜCRETSİZ VERİ KAZIMA (SCRAPING) FONKSİYONU
async function getFreeShipData(imo, shipName) {
    try {
        console.log(`[RADAR] ${shipName} (IMO: ${imo}) için ücretsiz veri aranıyor...`);
        
        // MyShipTracking'in açık uç noktasından veri çekmeyi deniyoruz
        const url = `https://www.myshiptracking.com/requests/autocomplete.php?type=0&site=1&limit=5&q=${imo}`;
        
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
            }
        });

        if (!response.ok) throw new Error("Sunucu isteği reddetti (Muhtemelen güvenlik duvarı).");

        const textData = await response.text();
        
        // Eğer boş dönmezse ve içinde verimiz varsa
        if (textData && textData.length > 5) {
            console.log(`[BAŞARILI] ${shipName} için radar verisi yakalandı!`);
            return true; // Şimdilik bağlantının koptuğunu veya başarılı olduğunu test ediyoruz
        } else {
            console.log(`[BAŞARISIZ] ${shipName} için güncel veri bulunamadı.`);
            return false;
        }

    } catch (error) {
        console.log(`[ENGEL] ${shipName} sorgusu engellendi veya hata aldı: ${error.message}`);
        return false;
    }
}

// 6. ANA KONTROL DÖNGÜSÜ (Her 15 dakikada bir çalışır)
async function checkShips() {
    console.log("Zaman kontrolü ve radar taraması başlıyor...");
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
            const shipName = (ship.name || "").toUpperCase().trim();
            const imo = (ship.imo || "").trim();
            const eta = new Date(ship.eta);
            const email = ship.email;

            // --- VİP FİLO KONTROLÜ VE RADAR TARAMASI ---
            if (targetFleet.includes(shipName) && imo !== "" && imo !== "BELİRTİLMEDİ") {
                // Gemi listemizde var, ücretsiz API'ye istek at!
                await getFreeShipData(imo, shipName);
                // Not: Eğer veri başarılı gelirse ilerleyen aşamada ETA'yı Firebase'de güncelleyeceğiz.
            }

            // --- SAAT VE MAİL HESAPLAMALARI (ESKİ SİSTEM DEVAM EDİYOR) ---
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
    } catch (error) {
        console.error("HATA OLUŞTU:", error);
    }
}

checkShips();
