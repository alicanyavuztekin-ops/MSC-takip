const nodemailer = require('nodemailer');

const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

// GMAİL SMTP MAİL MOTORU
async function sendEmail(toEmail, subject, body) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'mscgemitakip@gmail.com',
        pass: process.env.GMAIL_PASS
      }
    });

    const mailOptions = {
      from: 'MSC & MEDLOG TAKİP <mscgemitakip@gmail.com>',
      to: toEmail,
      subject: subject,
      text: body
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [GMAİL BAŞARILI] Mail fırlatıldı -> ${toEmail} | Konu: ${subject}`);
  } catch (err) {
    console.error(`💥 [GMAİL HATASI]:`, err);
  }
}

// FİREBASE VERİTABANI GÜNCELLEME
async function updateDoc(docName, updateFields) {
  const maskParams = Object.keys(updateFields).map(key => `updateMask.fieldPaths=${key}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${docName}?${maskParams}`;
  const fields = {};
  for (const [key, value] of Object.entries(updateFields)) {
    if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'string') fields[key] = { stringValue: value };
  }
  await fetch(url, {
    method: "PATCH",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
}

async function main() {
  console.log("⚓ MASTER CLOCK SİSTEMİ (GMAİL TÜM MAİLLER) BAŞLATILDI ⚓");
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

      const emailSentNew = fields.emailSentNew ? fields.emailSentNew.booleanValue : false;
      const emailSent10h = fields.emailSent10h ? fields.emailSent10h.booleanValue : false;
      const emailSent5h = fields.emailSent5h ? fields.emailSent5h.booleanValue : false;
      const emailSentArrived = fields.emailSentArrived ? fields.emailSentArrived.booleanValue : false;

      if (!etaStr || !email) continue;

      // 1. YENİ GEMİ EKLENDİ BİLDİRİMİ
      if (!emailSentNew) {
        console.log(`🔥 Yeni gemi eklendi maili gönderiliyor: ${name}`);
        const newShipMsg = `Yeni gemi operasyon listesine eklendi!\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nBEYANNAME: ${declarations}\nETA: ${etaStr}\n${note ? 'NOT: ' + note : ''}\n\nSistem varış saatine 10 ve 5 saat kala otomatik uyaracaktır.`;
        await sendEmail(email, `⚓ YENİ GEMİ EKLENDİ: ${name} (SEFER: ${voyage})`, newShipMsg);
        await updateDoc(doc.name, { emailSentNew: true });
      }

      const cleanEta = etaStr.includes('T') ? etaStr : etaStr.replace(' ', 'T');
      const etaDate = new Date(cleanEta + "+03:00");
      const diffHours = (etaDate - now) / (1000 * 60 * 60);

      // 2. 10 SAAT UYARISI
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 10 Saat kuralı tetiklendi: ${name}`);
        await sendEmail(email, `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`, `10 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nBEYANNAME: ${declarations}`);
        await updateDoc(doc.name, { emailSent10h: true });
      }
      // 3. 5 SAAT UYARISI
      else if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        console.log(`🔥 5 Saat kuralı tetiklendi: ${name}`);
        await sendEmail(email, `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`, `5 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}`);
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }
      // 4. LİMANA VARDI
      else if (diffHours <= 0 && !emailSentArrived) {
        console.log(`🔥 Limana varış tetiklendi: ${name}`);
        await sendEmail(email, `⚓ LİMANA VARDI: ${name}`, `GEMİ LİMANA ULAŞTI:\n\nGEMİ: ${name}\nSEFER: ${voyage}`);
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
      }
    }
  } catch (err) {
    console.error("💥 Hata:", err);
  }
}

main();
