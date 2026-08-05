const PROJECT_ID = "msc-takip";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ships`;

async function sendEmail(toEmail, subject, body) {
  try {
    const res = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(toEmail.toLowerCase()), {
      method: "POST",
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ _subject: subject, _from: "MSC & MEDLOG TAKİP", MESAJ: body, _captcha: "false" })
    });
    await res.json();
  } catch (err) {
    console.error("Mail hatası:", err);
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
    await fetch(url, { method: "PATCH", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  } catch (err) {
    console.error("Güncelleme hatası:", err);
  }
}

async function main() {
  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents) return;

    const now = new Date();
    now.setHours(now.getHours() + 3);

    for (const doc of data.documents) {
      const fields = doc.fields || {};
      if ((fields.status ? fields.status.stringValue : 'PENDING') === 'COMPLETED') continue;

      const name = fields.name ? fields.name.stringValue : 'GEMİ';
      const port = fields.port ? fields.port.stringValue : '';
      const etaStr = fields.eta ? fields.eta.stringValue : '';
      const declarations = fields.declarations ? (fields.declarations.integerValue || fields.declarations.stringValue) : '0';
      const email = fields.email ? fields.email.stringValue : '';
      const note = fields.note ? fields.note.stringValue : '';

      const emailSent10h = fields.emailSent10h ? fields.emailSent10h.booleanValue : false;
      const emailSent5h = fields.emailSent5h ? fields.emailSent5h.booleanValue : false;
      const emailSentArrived = fields.emailSentArrived ? fields.emailSentArrived.booleanValue : false;

      if (!etaStr || !email) continue;

      const diffHours = (new Date(etaStr) - now) / (1000 * 60 * 60);
      const hoursLeft = Math.floor(diffHours);
      const minsLeft = Math.floor((diffHours % 1) * 60);
      const timeFormatted = diffHours > 0 ? `${hoursLeft} SAAT ${minsLeft} DK` : 'LİMANDA';
      const noteText = note !== '' ? `\n\n📌 EK NOT: ${note}` : '';

      if (diffHours <= 10 && diffHours > 5 && !emailSent10h) {
        await sendEmail(email, `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`, `10 SAAT KALA UYARISI!\n\nGEMİ: ${name}\nLİMAN: ${port}\nKALAN: ${timeFormatted}\nBEYANNAME: ${declarations}${noteText}`);
        await updateDoc(doc.name, { emailSent10h: true });
      }
      if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        await sendEmail(email, `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`, `KRİTİK 5 SAAT UYARISI!\n\nGEMİ: ${name}\nLİMAN: ${port}\nKALAN: ${timeFormatted}\nBEYANNAME: ${declarations}${noteText}`);
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
      }
      if (diffHours <= 0 && !emailSentArrived) {
        await sendEmail(email, `⚓ LİMANA VARDI: ${name}`, `GEMİ LİMANA ULAŞTI!\n\nGEMİ: ${name}\nLİMAN: ${port}\nBEYANNAME: ${declarations}${noteText}`);
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
      }
    }
  } catch (err) { console.error(err); }
}
main();
