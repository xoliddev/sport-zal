// The desk's camera: the browser's own BarcodeDetector reads the member's QR from the video (Chrome, Edge, Android).
// Without it the desk types the short code under the QR. The same text is not sent twice within a few seconds.
export function cameraScanner(T) {
  return {
    mount(el, onText, ctx) {
      const lang = () => ctx.lang;
      let stream = null;
      let timer = null;
      let last = { text: '', at: 0 };
      const note = document.createElement('p');
      note.className = 'scan-note';
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
        note.textContent = T(lang(), 'adm.no_detector');
        el.replaceChildren(note);
        return () => {};
      }
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'p-btn solid';
      btn.textContent = T(lang(), 'adm.camera_on');
      note.textContent = T(lang(), 'adm.camera_hint');
      el.replaceChildren(note, btn);
      btn.addEventListener('click', async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        } catch {
          note.textContent = T(lang(), 'adm.camera_denied');
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        el.replaceChildren(video);
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          if (video.readyState < 2) return;
          try {
            const codes = await detector.detect(video);
            const text = codes[0]?.rawValue;
            if (!text || (text === last.text && Date.now() - last.at < 4000)) return;
            last = { text, at: Date.now() };
            onText(text);
          } catch { /* a frame the detector could not read */ }
        }, 350);
      });
      return () => {
        clearInterval(timer);
        stream?.getTracks().forEach((tr) => tr.stop());
      };
    },
  };
}
