const nodemailer = require('nodemailer');

const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

// GİMAİL SMTP İLE MAİL GÖNDERME MOTORU
async function sendEmail(toEmail, subject, body) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'mscgemitakip@gmail.com',
        pass: process.env.GMAIL_PASS // GitHub Secrets'dan güvenli çeker
      }
    });

    const mailOptions = {
      from: 'MSC & MEDLOG TAKİP <mscgemitakip@gmail.com>',
      to: toEmail,
      subject: subject,
      text: body
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ [GMAİL BAŞARILI] Mail bizzat senin adresinden fırlatıldı -> Hedef: ${toEmail}`);
  } catch (err) {
    console.error(`💥 [GMAİL HATASI]:`, err);
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
  console.log("⚓ MASTER CLOCK SİSTEMİ (GMAİL SMTP) BAŞLATILDI ⚓");
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
      const diffHours = (etaDate - now) / (1000 * 60 * 60);

      console.log(`🛳️ Gemi: ${name} | Kalan Süre: ${diffHours.toFixed(2)} saat`);

      // 10 SAAT KONTROLÜ
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 10 SAAT KURALI TETİKLENDİ! Gmail'den gönderiliyor...`);
        await sendEmail(email, `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`, `10 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nBEYANNAME: ${declarations}`);
        await updateDoc(doc.name, { emailSent10h: true });
      }
      // 5 SAAT KONTROLÜ
      else if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        console.log(`🔥 5 SAAT KURALI TETİKLENDİ! Gmail'den gönderiliyor...`);
        await sendEmail(email, `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`, `5 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}`);
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }
      // LİMANA VARDI KONTROLÜ
      else if (diffHours <= 0 && !emailSentArrived) {
        console.log(`🔥 LİMANA VARIŞ TETİKLENDİ! Gmail'den gönderiliyor...`);
        await sendEmail(email, `⚓ LİMANA VARDI: ${name}`, `GEMİ LİMANA ULAŞTI:\n\nGEMİ: ${name}\nSEFER: ${voyage}`);
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
      }
    }
  } catch (err) {
    console.error("💥 Kritik Hata:", err);
  }
}

main();
