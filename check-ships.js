const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

// EMAILJS ENTEGRASYONU (403 ENGELİNİ TAMAMEN AŞAN BULUT MAİL MOTORU)
async function sendEmail(toEmail, subject, body) {
  try {
    const data = {
      service_id: 'service_zxj2x6h',
      template_id: 'template_l284wkj',
      user_id: 'zS1YyMreF0dTfNovZ',
      template_params: {
        to_email: toEmail,
        subject: subject,
        message: body
      }
    };

    const res = await fetch("https://api.emailjs.com/v1.0/email/send", {
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      console.log(`✅ [EMAILJS BAŞARILI] Mail başarıyla fırlatıldı -> Hedef: ${toEmail}`);
    } else {
      const errText = await res.text();
      console.error(`❌ [EMAILJS REDDEDİLDİ] HTTP Kodu: ${res.status} | Hata: ${errText}`);
    }
  } catch (err) {
    console.error(`💥 [EMAILJS KRİTİK HATA]:`, err);
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
      console.log(`🔄 [VERİTABANI GÜNCELLENDİ]`);
    }
  } catch (err) {
    console.error("💥 [VERİTABANI HATASI]:", err);
  }
}

async function main() {
  console.log("=================================================");
  console.log("⚓ MASTER CLOCK SİSTEMİ (EMAILJS) UYANDI ⚓");

  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents) return;

    const now = new Date();

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

      const cleanEta = etaStr.includes('T') ? etaStr : etaStr.replace(' ', 'T');
      const etaDate = new Date(cleanEta + "+03:00");

      const diffMs = etaDate - now;
      const diffHours = diffMs / (1000 * 60 * 60);

      console.log(`🛳️ [ANALİZ] ${name} | Kalan: ${diffHours.toFixed(2)} saat | 10H Gönderildi mi?: ${emailSent10h}`);

      const hoursLeft = Math.floor(diffHours);
      const minsLeft = Math.floor((diffHours % 1) * 60);
      const timeFormatted = diffHours > 0 ? `${hoursLeft} SAAT ${minsLeft} DK` : 'LİMANDA';
      const noteText = note !== '' ? `\n\n📌 EK NOT: ${note}` : '';

      // 10 SAAT UYARISI
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 [TETİKLEME] -> ${name} için 10 Saat maili yollanıyor...`);
        await sendEmail(
          email,
          `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`,
          `10 SAAT KALA UYARISI!\n\nGEMİ: ${name}\nSEFER NO: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nKALAN SÜRE: ${timeFormatted}\nBEYANNAME: ${declarations} ADET${noteText}\n\nLütfen gümrük süreçlerini kontrol ediniz.`
        );
        await updateDoc(doc.name, { emailSent10h: true });
      }
      // 5 SAAT UYARISI
      else if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        console.log(`🔥 [TETİKLEME] -> ${name} için 5 Saat maili yollanıyor...`);
        await sendEmail(
          email,
          `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`,
          `KRİTİK 5 SAAT UYARISI!\n\nGEMİ: ${name}\nSEFER NO: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nKALAN SÜRE: ${timeFormatted}\nBEYANNAME: ${declarations} ADET${noteText}\n\nLütfen kapama işlemlerini hızlandırınız.`
        );
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }
      // LİMANA VARDI
      else if (diffHours <= 0 && !emailSentArrived) {
        console.log(`🔥 [TETİKLEME] -> ${name} için Limana Vardı maili yollanıyor...`);
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
    console.error("💥 [KRİTİK HATA]:", err);
  }
}

main();
