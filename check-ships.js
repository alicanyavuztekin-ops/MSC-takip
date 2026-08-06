const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

// FORM-SUBMIT ANTİ-BOT MASKESİ (Sunucuyu gerçek tarayıcı gibi gösterir)
async function sendEmail(toEmail, subject, body) {
  try {
    const res = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(toEmail.toLowerCase()), {
      method: "POST",
      headers: { 
        'Content-Type': 'application/json', 
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://alicanyavuztekin-ops.github.io',
        'Referer': 'https://alicanyavuztekin-ops.github.io/'
      },
      body: JSON.stringify({ _subject: subject, _from: "MSC & MEDLOG TAKİP", MESAJ: body, _captcha: "false" })
    });
    
    if (res.ok) {
        console.log(`✅ [MAİL BAŞARILI] Sinyal FormSubmit'e ulaştı -> Hedef: ${toEmail}`);
    } else {
        console.error(`❌ [MAİL REDDEDİLDİ] FormSubmit sunucuyu engelledi! HTTP Kodu: ${res.status}`);
    }
  } catch (err) {
    console.error(`💥 [MAİL CRASH HATASI] Ağ bağlantısı koptu -> ${toEmail}:`, err);
  }
}

async function updateDoc(docName, updateFields) {
  const maskParams = Object.keys(updateFields).map(key => `updateMask.fieldPaths=${key}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${docName}?${maskParams}`;
  const fields = {};
  for (const [key, value] of Object.entries(updateFields)) {
    if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'string') fields[key] = { stringValue: value };
  }
  try {
    const response = await fetch(url, { method: "PATCH", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    if (response.ok) {
      console.log(`🔄 [GÜNCELLEME] Veritabanı başarıyla işaretlendi.`);
    } else {
      console.error(`⚠️ [GÜNCELLEME HATASI] Firebase yetki vermedi! HTTP Kodu: ${response.status}`);
    }
  } catch (err) {
    console.error("[VERİTABANI CRASH] Güncelleme yapılamadı:", err);
  }
}

async function main() {
  console.log("=================================================");
  console.log("⚓ MASTER CLOCK SİSTEMİ UYANDI ⚓");
  
  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) {
        console.error(`🚨 [FİREBASE ERİŞİM ENGELİ] Veritabanı okunamıyor! Hata Kodu: ${res.status}`);
        return;
    }
    const data = await res.json();
    if (!data.documents) {
      console.log("ℹ️ [BİLGİ] Takip edilecek aktif/bekleyen gemi yok.");
      return;
    }

    const now = new Date(); 
    console.log(`⏱️ Sunucu Zamanı (UTC): ${now.toISOString()}`);

    for (const doc of data.documents) {
      const fields = doc.fields || {};
      if ((fields.status ? fields.status.stringValue : 'PENDING') === 'COMPLETED') continue;

      const name = fields.name ? fields.name.stringValue : 'GEMİ';
      const etaStr = fields.eta ? fields.eta.stringValue : '';
      const email = fields.email ? fields.email.stringValue : '';
      
      const emailSent10h = fields.emailSent10h ? fields.emailSent10h.booleanValue : false;
      const emailSent5h = fields.emailSent5h ? fields.emailSent5h.booleanValue : false;
      const emailSentArrived = fields.emailSentArrived ? fields.emailSentArrived.booleanValue : false;

      if (!etaStr || !email) continue;

      // ZAMAN HESAPLAMA MOTORU (Kesin Matematik)
      // Örnek etaStr: "2026-08-06T19:50"
      const cleanEta = etaStr.includes('T') ? etaStr : etaStr.replace(' ', 'T');
      const etaDate = new Date(cleanEta + "+03:00"); 
      
      const diffMs = etaDate - now;
      const diffHours = diffMs / (1000 * 60 * 60);

      console.log(`-------------------------------------------------`);
      console.log(`🛳️ [ANALİZ] GEMİ: ${name}`);
      console.log(`   - Kayıtlı ETA: ${cleanEta} (Türkiye Saati)`);
      console.log(`   - Kalan Saat Hesaplandı: ${diffHours.toFixed(2)} SAAT`);
      console.log(`   - Atılma Durumu -> 10H: ${emailSent10h}, 5H: ${emailSent5h}, Liman: ${emailSentArrived}`);

      // 10 SAAT TETİKLEYİCİ
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 [TETİKLEME] -> ${name} için 10 Saat kuralı çalıştı! Mail yollanıyor...`);
        await sendEmail(email, `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`, `Sistem Otomatik Uyarısı:\n\n${name} gemisinin varışına an itibariyle 10 saatin altına inilmiştir.`);
        await updateDoc(doc.name, { emailSent10h: true });
      } 
      else if (diffHours <= 10 && emailSent10h) {
        console.log(`⏩ [ATLANDI] ${name} kurala uyuyor ama 10 saat maili zaten ATILMIŞ.`);
      }
      else if (diffHours > 10) {
         console.log(`⏳ [BEKLEMEDE] ${name} için 10 saat kuralına henüz girilmedi.`);
      }

    }
    console.log("=================================================");
  } catch (err) { 
    console.error("💥 [KRİTİK SİSTEM ÇÖKMESİ]:", err); 
  }
}
main();
