// Public gallery. Photos are readable only after the admin publishes the
// gallery (RLS on gallery_photos), so an unpublished gallery shows "em breve".
(() => {
  'use strict';

  const { DEMO, client, $, esc } = window.Rifa;
  const lightbox = $('#lightbox');
  let photos = [];
  let current = 0;

  const publicUrl = (path) => client.storage.from('gallery').getPublicUrl(path).data.publicUrl;

  async function load() {
    if (DEMO) return showComingSoon();

    const [{ data: s }, { data: rows, error }] = await Promise.all([
      client.from('settings').select('gallery_enabled, gallery_title, gallery_message').eq('id', 1).single(),
      client.from('gallery_photos').select('path, caption').order('sort_order').order('created_at'),
    ]);
    if (error || !s?.gallery_enabled) return showComingSoon();

    document.title = `${s.gallery_title} · Rifa Campori 2027`;
    $('#galleryTitle').textContent = s.gallery_title;
    $('#galleryMessage').textContent = s.gallery_message;
    $('#messageCard').classList.toggle('hidden', !s.gallery_message);

    photos = (rows || []).map((p) => ({ src: publicUrl(p.path), caption: p.caption || '' }));
    $('#photos').innerHTML = photos.map((p, i) => `
      <figure data-index="${i}" tabindex="0" role="button" aria-label="Ampliar foto${p.caption ? `: ${esc(p.caption)}` : ''}">
        <img src="${esc(p.src)}" alt="${esc(p.caption)}" loading="lazy" decoding="async">
        ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
      </figure>`).join('');
  }

  function showComingSoon() {
    $('#comingSoon').classList.remove('hidden');
  }

  function open(index) {
    current = (index + photos.length) % photos.length;
    const p = photos[current];
    $('#lbImg').src = p.src;
    $('#lbImg').alt = p.caption;
    $('#lbCaption').textContent = p.caption;
    if (!lightbox.open) lightbox.showModal();
  }

  $('#photos').addEventListener('click', (e) => {
    const fig = e.target.closest('figure[data-index]');
    if (fig) open(Number(fig.dataset.index));
  });
  $('#photos').addEventListener('keydown', (e) => {
    const fig = e.target.closest('figure[data-index]');
    if (fig && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(Number(fig.dataset.index)); }
  });
  $('#lbPrev').addEventListener('click', () => open(current - 1));
  $('#lbNext').addEventListener('click', () => open(current + 1));
  $('#lbClose').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (e) => { if (e.target.classList.contains('lightbox-inner')) lightbox.close(); });
  lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') open(current - 1);
    if (e.key === 'ArrowRight') open(current + 1);
  });

  let touchX = null;
  lightbox.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) open(current + (dx < 0 ? 1 : -1));
    touchX = null;
  });

  window.Rifa.initNav();
  load();
})();
