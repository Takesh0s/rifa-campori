// Admin gallery tab: publish toggle, message and photo management.
// Starts after admin.js confirms the session (rifa:admin-ready).
(() => {
  'use strict';

  const { DEMO, client: sb, $, esc, toast } = window.Rifa;
  if (DEMO) return;

  const BUCKET = 'gallery';
  const MAX_SIDE = 1920;
  const QUALITY = 0.82;
  let photos = [];

  const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  document.addEventListener('rifa:admin-ready', ({ detail }) => {
    fillForm(detail.settings);
    loadPhotos();
  });

  function fillForm(s) {
    const form = $('#galleryForm');
    form.gallery_enabled.checked = !!s.gallery_enabled;
    form.gallery_title.value = s.gallery_title || '';
    form.gallery_message.value = s.gallery_message || '';
  }

  $('#galleryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const { error } = await sb.from('settings').update({
      gallery_enabled: form.gallery_enabled.checked,
      gallery_title: form.gallery_title.value.trim() || 'Memórias do Campori DSA',
      gallery_message: form.gallery_message.value.trim(),
    }).eq('id', 1);
    $('#gallerySaved').textContent = error ? `Erro: ${error.message}` : 'Salvo ✓';
    setTimeout(() => { $('#gallerySaved').textContent = ''; }, 3000);
  });

  async function loadPhotos() {
    const { data, error } = await sb.from('gallery_photos')
      .select('id, path, caption, sort_order').order('sort_order').order('created_at');
    if (error) return toast(`Erro ao carregar fotos: ${error.message}`);
    photos = data;
    render();
  }

  function render() {
    $('#photoGrid').innerHTML = photos.length ? photos.map((p, i) => `
      <div class="photo-admin" data-id="${p.id}">
        <img src="${esc(publicUrl(p.path))}" alt="" loading="lazy">
        <div class="body">
          <input data-caption value="${esc(p.caption || '')}" maxlength="200" placeholder="Legenda (opcional)">
          <div class="row-actions">
            <button class="btn small ghost" type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Mover para antes">↑</button>
            <button class="btn small ghost" type="button" data-move="1" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Mover para depois">↓</button>
            <button class="btn small ghost" type="button" data-delete aria-label="Excluir foto">🗑</button>
          </div>
        </div>
      </div>`).join('') : '<p class="muted">Nenhuma foto ainda.</p>';
  }

  // Re-encoding through a canvas resizes the image and drops all metadata,
  // including the GPS coordinates phones embed in photos.
  async function compress(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
    // Some browsers silently fall back to PNG when WebP encoding is unsupported.
    const webp = await toBlob('image/webp');
    if (webp?.type === 'image/webp') return { blob: webp, ext: 'webp' };
    return { blob: await toBlob('image/jpeg'), ext: 'jpg' };
  }

  async function upload(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    let nextOrder = photos.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
    let done = 0;

    for (const file of images) {
      $('#uploadStatus').textContent = `Enviando ${done + 1} de ${images.length}…`;
      try {
        const { blob, ext } = await compress(file);
        const path = `${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, {
          contentType: blob.type, cacheControl: '31536000', upsert: false,
        });
        if (up.error) throw up.error;

        const { error } = await sb.from('gallery_photos').insert({ path, sort_order: nextOrder++ });
        if (error) {
          await sb.storage.from(BUCKET).remove([path]);
          throw error;
        }
        done++;
      } catch (err) {
        console.error(err);
        toast(`Falha ao enviar ${file.name}: ${err.message}`);
      }
    }
    $('#uploadStatus').textContent = images.length ? `${done} de ${images.length} foto(s) enviada(s).` : '';
    await loadPhotos();
  }

  async function move(id, delta) {
    const from = photos.findIndex((p) => p.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= photos.length) return;
    const reordered = [...photos];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

    // Rewrite positions as 1..n so ties from earlier uploads cannot reorder randomly.
    const updates = reordered
      .map((p, i) => ({ ...p, sort_order: i + 1 }))
      .filter((p, i) => photos.find((o) => o.id === p.id).sort_order !== i + 1);
    photos = reordered.map((p, i) => ({ ...p, sort_order: i + 1 }));
    render();

    const results = await Promise.all(updates.map((p) =>
      sb.from('gallery_photos').update({ sort_order: p.sort_order }).eq('id', p.id)));
    if (results.some((r) => r.error)) {
      toast('Não consegui salvar a nova ordem.');
      loadPhotos();
    }
  }

  async function remove(id) {
    const photo = photos.find((p) => p.id === id);
    if (!photo || !confirm('Excluir esta foto? Não dá para desfazer.')) return;
    const { error } = await sb.from('gallery_photos').delete().eq('id', id);
    if (error) return toast(`Erro: ${error.message}`);
    await sb.storage.from(BUCKET).remove([photo.path]);
    photos = photos.filter((p) => p.id !== id);
    render();
  }

  $('#photoInput').addEventListener('change', (e) => {
    upload(e.target.files);
    e.target.value = '';
  });

  const zone = $('#uploadZone');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => upload(e.dataTransfer.files));

  $('#photoGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.photo-admin');
    if (!card) return;
    if (e.target.closest('[data-move]')) move(card.dataset.id, Number(e.target.closest('[data-move]').dataset.move));
    else if (e.target.closest('[data-delete]')) remove(card.dataset.id);
  });

  $('#photoGrid').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-caption]')) return;
    const id = e.target.closest('.photo-admin').dataset.id;
    const caption = e.target.value.trim() || null;
    const { error } = await sb.from('gallery_photos').update({ caption }).eq('id', id);
    if (error) return toast(`Erro: ${error.message}`);
    photos = photos.map((p) => (p.id === id ? { ...p, caption } : p));
    toast('Legenda salva ✓');
  });
})();
