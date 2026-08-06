async function main() {
  console.log("⚓ MASTER CLOCK SİSTEMİ ÇALIŞIYOR ⚓");
  try {
    const res = await fetch(FIRESTORE_URL);
    if (!res.ok) {
      console.error("Firebase veri okuma hatası:", res.status);
      return;
    }
    const data = await res.json();
    if (!data.documents) {
      console.log("Kayıtlı gemi yok.");
      return;
    }

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

      console.log(`🛳️ ${name} | Kalan: ${diffHours.toFixed(2)} saat | 10H Gönderildi mi?: ${emailSent10h}`);

      // 10 SAAT KONTROLÜ
      if (diffHours <= 10 && diffHours > 0 && !emailSent10h) {
        console.log(`🔥 10 Saat kuralı tetiklendi, mail gönderiliyor...`);
        await sendEmail(email, `🚨 UYARI: ${name} VARIŞA 10 SAAT KALA!`, `10 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}\nBEYANNAME: ${declarations}`);
        await updateDoc(doc.name, { emailSent10h: true });
        console.log(`✅ 10 Saat maili başarıyla işlendi ve veritabanı güncellendi.`);
      }
      // 5 SAAT KONTROLÜ
      else if (diffHours <= 5 && diffHours > 0 && !emailSent5h) {
        console.log(`🔥 5 Saat kuralı tetiklendi, mail gönderiliyor...`);
        await sendEmail(email, `🔴 KRİTİK: ${name} VARIŞA 5 SAAT KALA!`, `5 SAAT UYARISI:\n\nGEMİ: ${name}\nSEFER: ${voyage}\nROTA: ${originPort} -> ${destinationPort}`);
        await updateDoc(doc.name, { emailSent5h: true, emailSent10h: true });
        console.log(`✅ 5 Saat maili başarıyla işlendi ve veritabanı güncellendi.`);
      }
      // LİMANA VARDI KONTROLÜ
      else if (diffHours <= 0 && !emailSentArrived) {
        console.log(`🔥 Limana varış tetiklendi, mail gönderiliyor...`);
        await sendEmail(email, `⚓ LİMANA VARDI: ${name}`, `GEMİ LİMANA ULAŞTI:\n\nGEMİ: ${name}\nSEFER: ${voyage}`);
        await updateDoc(doc.name, { emailSentArrived: true, emailSent5h: true, emailSent10h: true });
        console.log(`✅ Liman maili başarıyla işlendi ve veritabanı güncellendi.`);
      } else {
        console.log(`⏳ Henüz mail atılacak eşikte değil veya zaten atılmış.`);
      }
    }
  } catch (err) {
    console.error("Ana döngü hatası:", err);
  }
}
