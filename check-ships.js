const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

async function sendEmail(toEmail, subject, body) {
  try {
    const response = await fetch("https://formsubmit.co/" + encodeURIComponent(toEmail.toLowerCase()), {
      method: "POST",
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _subject: subject,
        _from: "MSC & MEDLOG TAKİP",
        MESAJ: body,
        _captcha: "false"
      })
    });
    if (response.ok) {
      console.log(`✅ [MAİL BAŞARILI] Gönderildi -> ${toEmail}`);
    } else {
      console.error(`❌ [MAİL HATASI] Kod: ${response.status}`);
    }
  } catch (err) {
    console.error("💥 [BAĞLANTI HATASI]:", err);
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
  const res = await fetch(url, {
    method: "PATCH",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if(res.ok) {
    console.log(`🔄 Veritabanı işaretlendi: ${Object.keys(updateFields).join(', ')}`);
  }
}

async function main() {
  console.log("⚓ MASTER CLOCK SİSTEMİ BAŞLATILDI ⚓");
  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) {
      console.error("🚨 Firestore HTTP Hatası:", res.status);
      return;
    }
    const data = await res.json();
    
    if (!data.documents || data.documents.length === 0) {
      console.log("ℹ️ Veritabanında hiç gemi belgesi (document) bulunamadı.");
      return;
    }

    console.log(`📦 Toplam ${data.documents.length} adet gemi kaydı bulundu. Analiz başlıyor...`);
    const now = new Date();

    for (const doc of data.documents) {
      const fields = doc.fields || {};
      const name = fields.name ? fields.name.stringValue : 'BİLİNMEYEN GEMİ';
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

      console.log(`-----------------------------------------`);
      console.log(`🛳️ Gemi: ${name} | ETA: ${etaStr} | Mail: ${email}`);

      if (!etaStr || !email) {
        console.log(`⚠️ Eksik ETA veya Email, bu gemi atlanıyor.`);
        continue;
      }

      const cleanEta = etaStr.includes('T') ? etaStr : etaStr.replace(' ', 'T');
      const etaDate = new Date(cleanEta + "+03:00");
      const diffHours = (etaDate - now) / (1000 * 60 * 60);

      console.log(`⏱️ Hesaplanan Kalan Süre: ${diffHours.toFixed(2)} saat`);
      console.log(`📊 Bayraklar -> 10H: ${emailSent10h} | 5H: ${emailSent5h} | Liman: ${emailSentArrived}`);

      // 10 SAAT KONTROLÜ
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 10 SAAT KURALI TETİKLENDİ! Mail gönderiliyor...`);
        await sendEmail(email, `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`, `10 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nBEYANNAME: ${declarations}`);
        await updateDoc(doc.name, { emailSent10h: true });
      }
      // 5 SAAT KONTROLÜ
      else if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        console.log(`🔥 5 SAAT KURALI TETİKLENDİ! Mail gönderiliyor...`);
        await sendEmail(email, `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`, `5 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}`);
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }
      // LİMANA VARDI KONTROLÜ
      else if (diffHours <= 0 && !emailSentArrived) {
        console.log(`🔥 LİMANA VARIŞ TETİKLENDİ! Mail gönderiliyor...`);
        await sendEmail(email, `⚓ LİMANA VARDI: ${name}`, `GEMİ LİMANA ULAŞTI:\n\nGEMİ: ${name}\nSEFER: ${voyage}`);
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
      } else {
        console.log(`⏳ Bu gemi henüz mail eşiğinde değil.`);
      }
    }
  } catch (err) {
    console.error("💥 Kritik Hata:", err);
  }
}

main();
