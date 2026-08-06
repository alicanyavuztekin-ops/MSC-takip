const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

// FORM-SUBMIT ANTİ-BOT MAİL GÖNDERME FONKSİYONU
async function sendEmail(toEmail, subject, body) {
  try {
    const formData = new URLSearchParams();
    formData.append("_subject", subject);
    formData.append("_from", "MSC & MEDLOG TAKİP");
    formData.append("MESAJ", body);
    formData.append("_captcha", "false");

    const res = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(toEmail.toLowerCase()), {
      method: "POST",
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: formData
    });

    if (res.ok) {
      console.log(`✅ [MAİL BAŞARILI] Sinyal FormSubmit'e ulaştı -> Hedef: ${toEmail}`);
    } else {
      console.error(`❌ [MAİL REDDEDİLDİ] FormSubmit HTTP Kodu: ${res.status}`);
    }
  } catch (err) {
    console.error(`💥 [MAİL HATASI] Ağ bağlantısı koptu -> ${toEmail}:`, err);
  }
}

// FİREBASE VERİTABANI GÜNCELLEME FONKSİYONU
async function updateDoc(docName, updateFields) {
  const maskParams = Object.keys(updateFields).map(key => `updateMask.fieldPaths=${key}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${docName}?${maskParams}`;
  const fields = {};
  for (const [key, value] of Object.entries(updateFields)) {
    if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'string') fields[key] = { stringValue: value };
  }
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (response.ok) {
      console.log(`🔄 [VERİTABANI GÜNCELLENDİ] ${docName}`);
    } else {
      console.error(`⚠️ [GÜNCELLEME HATASI] Firebase HTTP Kodu: ${response.status}`);
    }
  } catch (err) {
    console.error("💥 [VERİTABANI HATASI]:", err);
  }
}

async function main() {
  console.log("=================================================");
  console.log("⚓ MASTER CLOCK SİSTEMİ UYANDI ⚓");

  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) {
      console.error(`🚨 [FİREBASE ERİŞİM ENGELİ] Hata Kodu: ${res.status}`);
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
      const voyage = fields.voyage ? fields.voyage.stringValue : 'BELİRTİLMEDİ';
      const originPort = fields.originPort ? fields.originPort.stringValue : 'BELİRTİLMEDİ';
      const destinationPort = fields.destinationPort ? fields.destinationPort.stringValue : 'BELİRTİLMEDİ';

      const etaStr = fields.eta ? fields.eta.stringValue : '';
      const declarations = fields.declarations ? (fields.declarations.integerValue || fields.declarations.stringValue) : '0';
      const email = fields.email ? fields.email.stringValue : '';
      const note = fields.note ? fields.note.stringValue : '';

      const emailSent10h = fields.emailSent10h ? fields.emailSent10h.booleanValue : false;
      const emailSent5h = fields.emailSent5h ? fields.emailSent5h.booleanValue : false;
      const emailSentArrived = fields.emailSentArrived ? fields.emailSentArrived.booleanValue : false;

      if (!etaStr || !email) continue;

      // ZAMAN HESAPLAMA (Türkiye Saati +03:00)
      const cleanEta = etaStr.includes('T') ? etaStr : etaStr.replace(' ', 'T');
      const etaDate = new Date(cleanEta + "+03:00");

      const diffMs = etaDate - now;
      const diffHours = diffMs / (1000 * 60 * 60);

      console.log(`-------------------------------------------------`);
      console.log(`🛳️ [ANALİZ] GEMİ: ${name} (Sefer: ${voyage})`);
      console.log(`   - Kayıtlı ETA: ${cleanEta} (Türkiye Saati)`);
      console.log(`   - Kalan Saat Hesaplandı: ${diffHours.toFixed(2)} SAAT`);
      console.log(`   - Atılma Durumu -> 10H: ${emailSent10h}, 5H: ${emailSent5h}, Liman: ${emailSentArrived}`);

      const hoursLeft = Math.floor(diffHours);
      const minsLeft = Math.floor((diffHours % 1) * 60);
      const timeFormatted = diffHours > 0 ? `${hoursLeft} SAAT ${minsLeft} DK` : 'LİMANDA';
      const noteText = note !== '' ? `\n\n📌 EK NOT: ${note}` : '';

      // 10 SAAT UYARISI
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 [TETİKLEME] -> ${name} için 10 Saat kuralı çalıştı! Mail yollanıyor...`);
        await sendEmail(
          email,
          `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`,
          `10 SAAT KALA UYARISI!\n\nGEMİ: ${name}\nSEFER NO: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nKALAN SÜRE: ${timeFormatted}\nBEYANNAME: ${declarations} ADET${noteText}\n\nLütfen gümrük süreçlerini kontrol ediniz.`
        );
        await updateDoc(doc.name, { emailSent10h: true });
      }
      // 5 SAAT UYARISI
      else if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        console.log(`🔥 [TETİKLEME] -> ${name} için 5 Saat kuralı çalıştı! Mail yollanıyor...`);
        await sendEmail(
          email,
          `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`,
          `KRİTİK 5 SAAT UYARISI!\n\nGEMİ: ${name}\nSEFER NO: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nKALAN SÜRE: ${timeFormatted}\nBEYANNAME: ${declarations} ADET${noteText}\n\nLütfen kapama işlemlerini hızlandırınız.`
        );
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }
      // LİMANA VARDI
      else if (diffHours <= 0 && !emailSentArrived) {
        console.log(`🔥 [TETİKLEME] -> ${name} için Limana Vardı kuralı çalıştı! Mail yollanıyor...`);
        await sendEmail(
          email,
          `⚓ LİMANA VARDI: ${name}`,
          `GEMİ LİMANA ULAŞTI!\n\nGEMİ: ${name}\nSEFER NO: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nBEYANNAME: ${declarations} ADET${noteText}\n\nOperasyon sürecini başlatabilirsiniz.`
        );
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
      }
    }
    console.log("=================================================");
  } catch (err) {
    console.error("💥 [KRİTİK SİSTEM ÇÖKMESİ]:", err);
  }
}

main();
