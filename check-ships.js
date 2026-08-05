const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

async function sendEmail(toEmail, subject, body) {
  try {
    const res = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(toEmail.toLowerCase()), {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        _subject: subject,
        _from: "MSC & MEDLOG TAKİP",
        MESAJ: body,
        _captcha: "false"
      })
    });
    const data = await res.json();
    console.log("Mail Başarıyla Gönderildi:", toEmail, data);
  } catch (err) {
    console.error("Mail Gönderme Hatası:", err);
  }
}

async function updateDoc(docName, updateFields) {
  const maskParams = Object.keys(updateFields).map(key => `updateMask.fieldPaths=${key}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${docName}?${maskParams}`;

  const fields = {};
  for (const [key, value] of Object.entries(updateFields)) {
    if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    }
  }

  try {
    await fetch(url, {
      method: "PATCH",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    console.log("Veritabanı Güncellendi:", docName, updateFields);
  } catch (err) {
    console.error("Güncelleme Hatası:", err);
  }
}

async function main() {
  console.log("Gemi süreleri kontrol ediliyor...");
  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) {
      console.log("Gemi kaydı bulunamadı veya erişim sağlanamadı.");
      return;
    }
    const data = await res.json();
    if (!data.documents || data.documents.length === 0) {
      console.log("Takipte gemi yok.");
      return;
    }

    const now = new Date();

    for (const doc of data.documents) {
      const fields = doc.fields || {};
      const status = fields.status ? fields.status.stringValue : 'PENDING';
      
      if (status === 'COMPLETED') continue;

      const name = fields.name ? fields.name.stringValue : 'GEMİ';
      const port = fields.port ? fields.port.stringValue : '';
      const etaStr = fields.eta ? fields.eta.stringValue : '';
      const declarations = fields.declarations ? (fields.declarations.integerValue || fields.declarations.stringValue) : '0';
      const email = fields.email ? fields.email.stringValue : '';

      const emailSent10h = fields.emailSent10h ? fields.emailSent10h.booleanValue : false;
      const emailSent5h = fields.emailSent5h ? fields.emailSent5h.booleanValue : false;
      const emailSentArrived = fields.emailSentArrived ? fields.emailSentArrived.booleanValue : false;

      if (!etaStr || !email) continue;

      const etaDate = new Date(etaStr);
      const diffMs = etaDate - now;
      const diffHours = diffMs / (1000 * 60 * 60);

      const hoursLeft = Math.floor(diffHours);
      const minsLeft = Math.floor((diffHours % 1) * 60);
      const timeFormatted = diffHours > 0 ? `${hoursLeft} SAAT ${minsLeft} DK` : 'LİMANDA';

      // 10 SAAT KALA MAİLİ
      if (diffHours <= 10 && diffHours > 5 && !emailSent10h) {
        const subject = `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`;
        const body = `10 SAAT KALA UYARISI!\n\nGEMİ ADI: ${name}\nVARIŞ LİMANI: ${port}\nKALAN SÜRE: ${timeFormatted}\nBEYANNAME ADEDİ: ${declarations}\n\nBEYANNAMELERİNİZİ KONTROL EDİNİZ.`;
        await sendEmail(email, subject, body);
        await updateDoc(doc.name, { emailSent10h: true });
      }

      // 5 SAAT KALA MAİLİ (KRİTİK)
      if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        const subject = `🔴 KRİTİK UYARI: ${name} VARIŞA 5 SAAT KALA!`;
        const body = `KRİTİK 5 SAAT KALA UYARISI!\n\nGEMİ ADI: ${name}\nVARIŞ LİMANI: ${port}\nKALAN SÜRE: ${timeFormatted}\nBEYANNAME ADEDİ: ${declarations}\n\nLÜTFEN BEYANNAME İŞLEMLERİNİ TAMAMLAYINIZ!`;
        await sendEmail(email, subject, body);
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }

      // LİMANA VARDI MAİLİ
      if (diffHours <= 0 && !emailSentArrived) {
        const subject = `⚓ GEMİ LİMANA VARDI: ${name}`;
        const body = `GEMİ LİMANA ULAŞTI!\n\nGEMİ ADI: ${name}\nVARIŞ LİMANI: ${port}\nBEYANNAME ADEDİ: ${declarations}\n\nBEYANNAME KAPAMA İŞLEMLERİNİ BAŞLATABİLİRSİNİZ.`;
        await sendEmail(email, subject, body);
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
      }
    }
  } catch (err) {
    console.error("Takip hatası:", err);
  }
}

main();
