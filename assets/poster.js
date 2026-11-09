// Shareable raffle poster ("cartela") drawn on a canvas from live data, in the
// layout of the original printed raffle. No buyer names: safe to post anywhere.
window.RifaPoster = (() => {
  'use strict';

  const W = 1080;
  const H = 1920;
  const COLS = 10;
  const C = {
    paper: '#f4e8cf', paper2: '#efe0c2', ink: '#2a2118', soft: '#6b5a45', line: '#bfae8c',
    cell: '#fbf5e8', sold: '#e7dcc6', res: '#f7dca4', orange: '#d9622b', green: '#2f5d3a',
  };
  const TITLE_FONT = '"Bebas Neue", Impact, sans-serif';
  const BODY_FONT = 'Nunito, system-ui, sans-serif';

  const loadImage = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  // Canvas does not wait for web fonts; load them explicitly or text falls back.
  async function loadFonts() {
    if (!document.fonts?.load) return;
    await Promise.allSettled([
      document.fonts.load(`400 80px ${TITLE_FONT}`),
      document.fonts.load(`800 30px ${BODY_FONT}`),
      document.fonts.load(`700 30px ${BODY_FONT}`),
    ]);
  }

  const money = (v) => Number(v).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0,
  });

  function drawX(ctx, x, y, w, h) {
    const px = w * 0.3;
    const py = h * 0.12;
    ctx.save();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + px, y + py);
    ctx.quadraticCurveTo(x + w / 2 + 3, y + h / 2 - 2, x + w - px, y + h - py);
    ctx.moveTo(x + w - px, y + py);
    ctx.quadraticCurveTo(x + w / 2 - 2, y + h / 2 + 3, x + px, y + h - py);
    ctx.stroke();
    ctx.restore();
  }

  function fitText(ctx, text, maxWidth, font, startSize) {
    let size = startSize;
    do {
      ctx.font = font.replace('{s}', size);
      size -= 2;
    } while (ctx.measureText(text).width > maxWidth && size > 10);
  }

  // statusOf(n) -> 'available' | 'reserved' | 'paid'
  async function generate({ settings: s, total, statusOf }) {
    await loadFonts();
    const [tent, qr] = await Promise.all([loadImage('/assets/tent.png'), loadImage('/assets/qr-site.png')]);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#f7eedb');
    bg.addColorStop(1, C.paper2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Header
    const HEADER = 380;
    ctx.fillStyle = C.ink;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    fitText(ctx, s.title.toUpperCase(), W - 80, `400 {s}px ${TITLE_FONT}`, 104);
    ctx.fillText(s.title.toUpperCase(), W / 2, 122);

    ctx.fillStyle = C.soft;
    ctx.font = `700 46px ${BODY_FONT}`;
    ctx.fillText(s.subtitle, W / 2 - 40, 190);

    if (tent) ctx.drawImage(tent, 740, 150, 250, 165);

    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    fitText(ctx, `Prêmio: ${s.prize}`, 620, `800 {s}px ${BODY_FONT}`, 58);
    ctx.fillText(`Prêmio: ${s.prize}`, 90, 285);
    ctx.fillStyle = C.orange;
    fitText(ctx, `Apenas ${money(s.ticket_price)} por número`, W - 180, `800 {s}px ${BODY_FONT}`, 58);
    ctx.fillText(`Apenas ${money(s.ticket_price)} por número`, 90, 352);

    // Grid
    const rows = Math.ceil(total / COLS);
    const FOOTER = 330;
    const cw = W / COLS;
    const ch = (H - HEADER - FOOTER) / rows;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.min(26, Math.round(ch * 0.5))}px ${BODY_FONT}`;
    let free = 0;
    for (let n = 1; n <= total; n++) {
      const col = (n - 1) % COLS;
      const row = Math.floor((n - 1) / COLS);
      const x = col * cw;
      const y = HEADER + row * ch;
      const st = statusOf(n);
      ctx.fillStyle = st === 'paid' ? C.sold : st === 'reserved' ? C.res : C.cell;
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, cw - 1.5, ch - 1.5);
      ctx.fillStyle = st === 'available' ? C.ink : 'rgba(42,33,24,.35)';
      ctx.fillText(String(n), x + cw / 2, y + ch / 2 + 1);
      if (st === 'paid') drawX(ctx, x, y, cw, ch);
      if (st === 'available') free++;
    }

    // Footer
    const fy = H - FOOTER;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const qrSize = 230;
    const qrX = 50;
    const qrY = fy + 40;
    if (qr) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
      ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
    }
    const tx = qrX + qrSize + 44;
    const tw = W - tx - 40;
    ctx.fillStyle = C.ink;
    fitText(ctx, 'GARANTA JÁ O SEU NÚMERO!', tw, `400 {s}px ${TITLE_FONT}`, 64);
    ctx.fillText('GARANTA JÁ O SEU NÚMERO!', tx, fy + 92);
    ctx.fillStyle = C.green;
    ctx.font = `800 40px ${BODY_FONT}`;
    ctx.fillText('rifa-campori.vercel.app', tx, fy + 145);
    ctx.fillStyle = C.ink;
    fitText(ctx, `Pix: ${s.pix_key}`, tw, `800 {s}px ${BODY_FONT}`, 32);
    ctx.fillText(`Pix: ${s.pix_key}`, tx, fy + 197);
    ctx.fillStyle = C.soft;
    fitText(ctx, s.pix_holder, tw, `700 {s}px ${BODY_FONT}`, 26);
    ctx.fillText(s.pix_holder, tx, fy + 236);

    const stamp = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    ctx.font = `700 24px ${BODY_FONT}`;
    ctx.fillStyle = C.orange;
    ctx.fillText(`${free} números livres · atualizado em ${stamp}`, tx, fy + 280);
    ctx.fillStyle = C.soft;
    ctx.font = `700 21px ${BODY_FONT}`;
    ctx.fillText('X = vendido   ·   amarelo = reservado', tx, fy + 310);

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // On phones the share sheet lets the image go straight to WhatsApp;
  // elsewhere fall back to a regular download.
  async function shareOrDownload(blob, filename, title) {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  return { generate, shareOrDownload };
})();
