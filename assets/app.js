// Public raffle page. Reads are direct from Supabase (public tables + realtime);
// every write goes through the /api functions, which hold the service key.
(() => {
  'use strict';

  const { DEMO, client: sb, $, esc, brl, listText, toast, myOrders } = window.Rifa;

  const DEFAULT_SETTINGS = {
    title: 'Rifa Solidária – Campori 2027', subtitle: 'Campori DSA', prize: 'R$ 500',
    ticket_price: 15, total_numbers: 300, goal_amount: 4500, goal_label: 'Meta: todos os números vendidos',
    draw_info: null, whatsapp: '5561984936058', pix_key: '61984936058',
    pix_holder: 'Luiz Phillipe de Souza Santos – Banco Inter', sales_open: true,
    pix_minutes: 30, hold_hours: 48, max_per_order: 30,
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    tickets: new Map(),
    selected: new Set(),
    supporters: [],
    order: null,
    timers: {},
    lastRaised: 0,
    celebratedGoal: false,
    // Numbers this browser is reserving right now. Realtime events for them can
    // arrive before the API response and must not be treated as "taken by someone else".
    inflight: new Set(),
  };

  const sorted = (set) => [...set].sort((a, b) => a - b);

  function effectiveStatus(t) {
    if (!t) return 'available';
    if (t.status === 'reserved' && t.reserved_until && new Date(t.reserved_until) < new Date()) return 'available';
    return t.status;
  }

  function animateNumber(el, from, to, fmt, ms = 1400) {
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function confettiBurst(big = false) {
    if (!window.confetti) return;
    const colors = ['#d9622b', '#f08a3c', '#2f5d3a', '#e7a93a', '#3f7f7a'];
    window.confetti({ particleCount: big ? 180 : 90, spread: big ? 100 : 70, origin: { y: 0.65 }, colors });
    if (big) setTimeout(() => window.confetti({ particleCount: 120, angle: 120, spread: 60, origin: { x: 1, y: .7 }, colors }), 300);
  }

  function whatsappMessage({ name, numbers, code }) {
    const s = state.settings;
    const total = brl(numbers.length * s.ticket_price, true);
    const qtd = numbers.length === 1 ? '1 número' : `${numbers.length} números`;
    const lines = [
      'Olá, Luiz! 👋',
      `Acabei de escolher meus números na *${s.title}* ⛺`,
      '',
      `🎟️ *Números:* ${listText(numbers)}`,
      `💰 *Total:* ${total} (${qtd})`,
      `🙋 *Nome:* ${name}`,
      '',
      'Prefiro pagar *em mãos* 🤝',
      code
        ? `Já deixei reservado no site (código *#${code}*). Como fica melhor pra gente combinar?`
        : 'Consegue reservar esses números pra mim? Como fica melhor pra gente combinar?',
      '',
      'Bora levar o clube pro Campori! 🔥',
    ];
    return `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  async function loadAll() {
    if (DEMO) return loadDemo();
    const [settings, tickets, supporters] = await Promise.all([
      sb.from('settings').select('*').eq('id', 1).single(),
      sb.from('tickets').select('number,status,reserved_until').order('number'),
      sb.rpc('get_supporters'),
    ]);
    if (settings.data) state.settings = { ...DEFAULT_SETTINGS, ...settings.data };
    (tickets.data || []).forEach((t) => state.tickets.set(t.number, t));
    state.supporters = supporters.data || [];
  }

  function loadDemo() {
    $('#demoBanner').classList.remove('hidden');
    const sold = [3,5,7,10,11,12,13,16,17,18,19,23,24,25,27,28,30,33,36,42,43,44,45,47,51,52,56,61,65,66,67,68,69,70,71,73,74,76,77,79,88,91,107,113,125,126,135,136,137,138,139,147,168,171,181,186,187,203,205,222,224,228,229,258,264,266,273,274,276,277,284,294,296,299,300];
    for (let n = 1; n <= 300; n++) state.tickets.set(n, { number: n, status: sold.includes(n) ? 'paid' : 'available' });
    state.tickets.set(150, { number: 150, status: 'reserved', reserved_until: new Date(Date.now() + 864e5).toISOString() });
    state.supporters = [['Gil',10],['Tia Netinha',6],['Esmael',4],['Tio Toninho',3],['Jean',2],['Luiz',2],['Douglas',2],['Da Silva',2],['Tia da Iara',2],['Terezinha',2],['Lídio',2],['Valdelice',2],['Silvia',2],['Vanessa',2],['Betinho',2],['Sonia',2],['Vagner',2],['Eusenir',2],['Ana Lúcia e Ely',1],['Andreia',1],['Ismaias',1],['Cleber',1],['Junior',1],['Josué',1],['Rony e Vera',1],['Leda',1],['Keké',1],['Margareth',1],['Robson',1],['Marilene (Tica)',1],['Marciley',1],['Nicivalda',1],['Elizete',1],['Zelito',1],['Mãe da Stefany',1],['Gerlucia',1],['Lilian',1],['Diolina',1],['Arlene',1],['João',1],['Pai da Iara',1],['Satoru',1]]
      .map(([name, qty]) => ({ name, qty }));
  }

  async function refreshSupporters() {
    if (DEMO) return renderWall();
    const { data } = await sb.rpc('get_supporters');
    const before = new Set(state.supporters.map((s) => s.name));
    state.supporters = data || [];
    renderWall(state.supporters.filter((s) => !before.has(s.name)).map((s) => s.name));
  }

  function renderSettings() {
    const s = state.settings;
    document.title = s.title;
    $('#title').innerHTML = esc(s.title).replace(' – ', ' <span class="dash">–</span> ');
    $('#subtitle').textContent = s.subtitle;
    $('#prize').textContent = s.prize;
    $('#price').textContent = brl(s.ticket_price);
    $('#drawChip').classList.toggle('hidden', !s.draw_info);
    $('#drawInfo').textContent = s.draw_info || '';
    $('#pixKey').textContent = s.pix_key;
    $('#pixHolder').textContent = s.pix_holder;
    $('#holdHours').textContent = `${s.hold_hours}h`;
    $('#totalCount').textContent = s.total_numbers;
    $('#payHand small').textContent = `Reserva por ${s.hold_hours}h e abre o WhatsApp com a mensagem pronta`;
    $('#galleryBanner').classList.toggle('hidden', !s.gallery_enabled);
    window.Rifa.setGalleryVisible(!!s.gallery_enabled);
  }

  function buildGrid() {
    const grid = $('#grid');
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= state.settings.total_numbers; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'num';
      b.dataset.n = n;
      b.textContent = n;
      frag.appendChild(b);
    }
    grid.appendChild(frag);
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.num');
      if (!btn || btn.disabled) return;
      toggleNumber(Number(btn.dataset.n));
    });
    for (let n = 1; n <= state.settings.total_numbers; n++) updateCell(n);
  }

  function updateCell(n, flash = false) {
    const btn = $(`#grid .num[data-n="${n}"]`);
    if (!btn) return;
    const st = effectiveStatus(state.tickets.get(n));
    const sel = state.selected.has(n);
    btn.className = 'num' + (st !== 'available' ? ` ${st}` : '') + (sel ? ' selected' : '') + (flash ? ' flash' : '');
    btn.disabled = st !== 'available' || !state.settings.sales_open;
    const label = { available: 'disponível', reserved: 'reservado', paid: 'vendido' }[st];
    btn.setAttribute('aria-label', `Número ${n}, ${sel ? 'selecionado' : label}`);
    btn.setAttribute('aria-pressed', sel);
  }

  function counts() {
    let paid = 0, reserved = 0, free = 0;
    for (let n = 1; n <= state.settings.total_numbers; n++) {
      const st = effectiveStatus(state.tickets.get(n));
      if (st === 'paid') paid++; else if (st === 'reserved') reserved++; else free++;
    }
    return { paid, reserved, free };
  }

  function renderProgress() {
    const s = state.settings;
    const { paid, reserved, free } = counts();
    const raised = paid * s.ticket_price;
    const goal = Number(s.goal_amount) || s.total_numbers * s.ticket_price;
    const pct = Math.min(100, (raised / goal) * 100);

    animateNumber($('#raised'), state.lastRaised, raised, (v) => brl(Math.round(v)));
    if (raised > state.lastRaised && state.lastRaised > 0) $('#raised').parentElement.classList.add('bump');
    setTimeout(() => $('#raised').parentElement.classList.remove('bump'), 800);
    state.lastRaised = raised;

    $('#pct').textContent = `${Math.floor(pct)}%`;
    $('#barFill').style.width = `${Math.max(pct, 2)}%`;
    $('#barMarker').style.left = `${Math.max(pct, 2)}%`;
    $('#barMarker span').textContent = pct >= 100 ? '⛺' : '🔥';
    $('#bar').setAttribute('aria-valuenow', Math.floor(pct));
    $('#soldCount').textContent = paid;
    $('#remaining').textContent = raised >= goal
      ? `Meta de ${brl(goal)} alcançada!`
      : `Faltam ${brl(goal - raised)} para a meta de ${brl(goal)}`;
    $('#goalTitle').title = s.goal_label || '';

    $('#milestones').innerHTML = [25, 50, 75, 100]
      .map((m) => `<span style="left:${m === 100 ? 97 : m}%" class="${pct >= m ? 'hit' : ''}">${pct >= m ? '✓ ' : ''}${m}%</span>`).join('');

    const msg =
      pct >= 100 ? '🎉 META BATIDA! Muito, muito obrigado a cada um que colaborou!' :
      pct >= 75 ? '🙌 Reta final! Falta pouquinho para a meta.' :
      pct >= 50 ? '🏕️ Passamos da metade do caminho! Obrigado a todos!' :
      pct >= 25 ? '🥾 Já estamos na trilha! Cada número nos leva mais longe.' :
      pct >= 10 ? '🔥 A fogueira já está acesa! Bora manter ela queimando.' :
      '⛺ Cada número ajuda a montar nossa barraca no Campori!';
    $('#progressMsg').textContent = msg;

    if (pct >= 100 && !state.celebratedGoal) { state.celebratedGoal = true; setTimeout(() => confettiBurst(true), 900); }

    $('#counts').textContent = `${free} disponíveis · ${reserved} reservados · ${paid} vendidos`;
  }

  function renderWall(newNames = []) {
    const list = state.supporters;
    const wall = $('#wall');
    $('#supportersCount').textContent = list.length
      ? (list.length === 1 ? '1 pessoa já está ajudando a levar nosso clube ao Campori.'
        : `${list.length} pessoas já estão ajudando a levar nosso clube ao Campori.`)
      : 'Seja a primeira pessoa a ajudar nosso clube a chegar ao Campori!';
    if (!list.length) { wall.innerHTML = ''; return; }
    const chip = (s) => `<span class="thanks${newNames.includes(s.name) ? ' new' : ''}">💛 ${esc(s.name)}${s.qty > 1 ? `<em>×${s.qty}</em>` : ''}</span>`;
    const half = Math.ceil(list.length / 2);
    const rows = list.length > 6 ? [list.slice(0, half), list.slice(half)] : [list];
    wall.innerHTML = rows.map((row, i) => {
      let items = row;
      while (items.length < 8) items = items.concat(row);
      const html = items.map(chip).join('');
      // Content is duplicated so the CSS marquee (translateX -50%) loops seamlessly.
      return `<div class="wall-row${i ? ' reverse' : ''}">${html}${html}</div>`;
    }).join('');
  }

  function renderCart() {
    const nums = sorted(state.selected);
    const total = nums.length * state.settings.ticket_price;
    $('#cart').classList.toggle('show', nums.length > 0);
    $('#cartNums').textContent = nums.length ? `🎟️ ${nums.join(' · ')}` : '';
    $('#cartTotal').textContent = `${nums.length} ${nums.length === 1 ? 'número' : 'números'} · ${brl(total, true)}`;
  }

  function toggleNumber(n) {
    if (state.selected.has(n)) state.selected.delete(n);
    else {
      if (state.selected.size >= state.settings.max_per_order) {
        return toast(`Máximo de ${state.settings.max_per_order} números por vez 😉`);
      }
      state.selected.add(n);
    }
    updateCell(n);
    renderCart();
  }

  function pickLucky() {
    const free = [];
    for (let n = 1; n <= state.settings.total_numbers; n++) {
      if (effectiveStatus(state.tickets.get(n)) === 'available' && !state.selected.has(n)) free.push(n);
    }
    if (!free.length) return toast('Não sobrou nenhum número livre!');
    const n = free[Math.floor(Math.random() * free.length)];
    toggleNumber(n);
    const btn = $(`#grid .num[data-n="${n}"]`);
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`🎲 Que tal o ${n}?`);
  }

  function subscribeRealtime() {
    if (DEMO) return;
    sb.channel('rifa-public')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, ({ new: t }) => {
        if (!t?.number) return;
        const prev = effectiveStatus(state.tickets.get(t.number));
        state.tickets.set(t.number, t);
        const now = effectiveStatus(t);
        if (state.selected.has(t.number) && now !== 'available' && !isMine(t.number)) {
          state.selected.delete(t.number);
          renderCart();
          toast(`Ops! O número ${t.number} acabou de ser escolhido por outra pessoa.`);
        }
        updateCell(t.number, prev !== now);
        if (prev !== now) {
          renderProgress();
          if (now === 'paid') {
            if (isMine(t.number)) checkOrderNow();
            else throttledPaidToast(t.number);
            debounce('supporters', refreshSupporters, 1500);
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'settings' }, ({ new: s }) => {
        state.settings = { ...state.settings, ...s };
        renderSettings(); renderProgress();
      })
      .subscribe();
  }

  const isMine = (n) => state.order?.numbers?.includes(n) || state.inflight.has(n);
  const debounce = (key, fn, ms) => { clearTimeout(state.timers[key]); state.timers[key] = setTimeout(fn, ms); };
  let pendingPaid = [];
  function throttledPaidToast(n) {
    pendingPaid.push(n);
    debounce('paidToast', () => {
      const list = pendingPaid; pendingPaid = [];
      toast(list.length === 1 ? `🎉 O número ${list[0]} acabou de ser garantido!` : `🎉 ${list.length} números acabaram de ser garantidos!`);
    }, 900);
  }

  const dialog = $('#checkout');
  function showStep(step) {
    dialog.querySelectorAll('[data-step]').forEach((el) => el.classList.toggle('hidden', el.dataset.step !== step));
  }

  function openCheckout() {
    const nums = sorted(state.selected);
    if (!nums.length) return;
    $('#pickList').innerHTML = nums.map((n) => `<span>${n}</span>`).join('');
    $('#modalTotal').textContent = brl(nums.length * state.settings.ticket_price, true);
    $('#formError').textContent = '';
    $('#emailField').classList.remove('show');
    $('#payPix b').textContent = 'Pagar agora com Pix';
    showStep('form');
    dialog.showModal();
    setTimeout(() => $('#fName').focus(), 50);
  }

  function readForm() {
    const name = $('#fName').value.trim();
    if (name.length < 2) { $('#formError').textContent = 'Informe seu nome 🙂'; $('#fName').focus(); return null; }
    const phoneDigits = $('#fPhone').value.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      $('#formError').textContent = 'Informe seu WhatsApp com DDD para avisarmos do sorteio.'; $('#fPhone').focus(); return null;
    }
    try { localStorage.setItem('rifa:buyer', JSON.stringify({ name, phone: $('#fPhone').value })); } catch {}
    return {
      name,
      phone: $('#fPhone').value,
      email: $('#fEmail').value.trim(),
      showOnWall: $('#fWall').checked,
      numbers: sorted(state.selected),
    };
  }

  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  }

  function handleTaken(taken) {
    taken.forEach((n) => {
      state.selected.delete(n);
      const t = state.tickets.get(n) || { number: n };
      state.tickets.set(n, { ...t, status: 'reserved', reserved_until: new Date(Date.now() + 36e5).toISOString() });
      updateCell(n, true);
    });
    renderCart();
    const left = sorted(state.selected);
    $('#pickList').innerHTML = left.map((n) => `<span>${n}</span>`).join('');
    $('#modalTotal').textContent = brl(left.length * state.settings.ticket_price, true);
    $('#formError').textContent = `Poxa, o${taken.length > 1 ? 's números' : ' número'} ${listText(taken)} acab${taken.length > 1 ? 'aram' : 'ou'} de ser escolhido${taken.length > 1 ? 's' : ''}. ${left.length ? 'Pode continuar com os outros!' : 'Escolha outro na grade.'}`;
    if (!left.length) setTimeout(() => dialog.close(), 2500);
  }

  async function payWithPix() {
    const emailField = $('#emailField');
    if (!emailField.classList.contains('show')) {
      emailField.classList.add('show');
      $('#payPix b').textContent = 'Gerar QR Code Pix';
      $('#fEmail').focus();
      return;
    }
    const buyer = readForm();
    if (!buyer) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyer.email)) {
      $('#formError').textContent = 'Informe um e-mail válido para gerar o Pix.'; $('#fEmail').focus(); return;
    }
    setBusy(true);
    if (DEMO) return demoPix(buyer);
    const { ok, status, data } = await api('/api/create-pix', buyer);
    setBusy(false);
    if (!ok) {
      if (status === 409 && data.taken?.length) return handleTaken(data.taken);
      $('#formError').textContent = data.error || 'Não foi possível gerar o Pix. Tente novamente.';
      return;
    }
    startPix(data);
  }

  function startPix(order) {
    state.order = order;
    myOrders.add({ ...order, method: 'pix' });
    window.Rifa.initNav();
    $('#qrImg').src = `data:image/png;base64,${order.qrCodeBase64}`;
    $('#pixCode').value = order.qrCode || '';
    showStep('pix');
    const end = new Date(order.expiresAt || order.expires_at).getTime();
    clearInterval(state.timers.countdown);
    state.timers.countdown = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $('#pixTimer').textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (!left) clearInterval(state.timers.countdown);
    }, 1000);
    clearInterval(state.timers.poll);
    state.timers.poll = setInterval(checkOrderNow, 4000);
  }

  async function checkOrderNow() {
    if (!state.order || DEMO) return;
    try {
      const r = await fetch(`/api/order-status?id=${state.order.id}`);
      const d = await r.json();
      if (d.status === 'paid') onPaid(state.order.numbers);
      else if (d.status === 'expired' || d.status === 'cancelled') onProblem('O Pix expirou ⏰', 'Os números foram liberados. Você pode escolher de novo quando quiser.');
      else if (d.status === 'conflict') onProblem('Pagamento recebido!', 'Mas um dos números foi pego enquanto o Pix estava vencido. Fique tranquilo: o Luiz vai falar com você para trocar o número ou devolver.');
    } catch {}
  }

  function stopPix() {
    clearInterval(state.timers.poll);
    clearInterval(state.timers.countdown);
  }

  function onPaid(numbers) {
    stopPix();
    state.order = null;
    $('#paidList').innerHTML = numbers.map((n) => `<span>${n}</span>`).join('');
    showStep('paid');
    if (!dialog.open) dialog.showModal();
    confettiBurst(true);
    state.selected.clear();
    renderCart();
    numbers.forEach((n) => updateCell(n, true));
  }

  function onProblem(title, text) {
    stopPix();
    state.order = null;
    $('#problemTitle').textContent = title;
    $('#problemText').textContent = text;
    showStep('problem');
  }

  function demoPix(buyer) {
    setBusy(false);
    const fakeQr = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    startPix({ id: 'demo', accessToken: `demo-${Date.now()}`, code: 'DEMO', numbers: buyer.numbers, qrCode: '00020126...DEMONSTRACAO', qrCodeBase64: fakeQr, expiresAt: new Date(Date.now() + 30 * 60000).toISOString() });
    toast('Modo demonstração: simulando pagamento em 5s…');
    setTimeout(() => {
      buyer.numbers.forEach((n) => state.tickets.set(n, { number: n, status: 'paid' }));
      state.supporters.unshift({ name: buyer.name.split(' ')[0], qty: buyer.numbers.length });
      onPaid(buyer.numbers); renderProgress(); renderWall([buyer.name.split(' ')[0]]);
    }, 5000);
  }

  async function payInPerson() {
    const buyer = readForm();
    if (!buyer) return;
    setBusy(true);
    let code = null;
    if (!DEMO) {
      const { ok, status, data } = await api('/api/reserve', buyer);
      if (!ok && status === 409 && data.taken?.length) { setBusy(false); return handleTaken(data.taken); }
      if (!ok && status < 500 && status !== 404) { setBusy(false); $('#formError').textContent = data.error || 'Erro ao reservar.'; return; }
      if (ok) {
        code = data.code;
        myOrders.add({ ...data, method: 'in_person' });
      }
    } else {
      code = 'DEMO01';
      myOrders.add({ accessToken: `demo-${Date.now()}`, code, numbers: buyer.numbers, method: 'in_person' });
    }
    window.Rifa.initNav();
    setBusy(false);
    $('#whatsLink').href = whatsappMessage({ name: buyer.name, numbers: buyer.numbers, code });
    $('#handCode').textContent = code ? `#${code}` : '— (reserva pelo WhatsApp)';
    showStep('hand');
    state.selected.clear();
    renderCart();
  }

  function setBusy(b) {
    state.inflight = b ? new Set(state.selected) : new Set();
    ['#payPix', '#payHand'].forEach((s) => { $(s).disabled = b; });
    if (b) $('#formError').textContent = '';
    dialog.style.cursor = b ? 'progress' : '';
  }

  function bindEvents() {
    $('#continueBtn').addEventListener('click', openCheckout);
    $('#clearBtn').addEventListener('click', () => {
      const prev = sorted(state.selected); state.selected.clear(); prev.forEach((n) => updateCell(n)); renderCart();
    });
    $('#luckyBtn').addEventListener('click', pickLucky);
    $('#onlyFree').addEventListener('change', (e) => $('#grid').classList.toggle('only-free', e.target.checked));
    $('#payPix').addEventListener('click', payWithPix);
    $('#payHand').addEventListener('click', payInPerson);
    $('#copyPix').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#pixCode').value); } catch { $('#pixCode').select(); document.execCommand('copy'); }
      $('#copyPix').textContent = 'Copiado! ✓';
      setTimeout(() => { $('#copyPix').textContent = 'Copiar'; }, 2000);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === dialog) closeCheckout();
    });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeCheckout(); });
    $('#fPhone').addEventListener('input', (e) => {
      const d = e.target.value.replace(/\D/g, '').slice(0, 11);
      e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`
        : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
    });
    // Expired holds produce no realtime event, so re-evaluate them periodically.
    setInterval(() => { for (let n = 1; n <= state.settings.total_numbers; n++) updateCell(n); renderProgress(); }, 30000);
    // Buyers usually switch to their bank app to pay; check as soon as they return.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkOrderNow(); });
  }

  function closeCheckout() {
    if (state.order && !confirm('Fechar esta tela? Se você já pagou, a confirmação chega mesmo assim.')) return;
    if (state.order) { stopPix(); state.order = null; }
    dialog.close();
  }

  function restoreBuyer() {
    try {
      const b = JSON.parse(localStorage.getItem('rifa:buyer') || 'null');
      if (b) { $('#fName').value = b.name || ''; $('#fPhone').value = b.phone || ''; }
    } catch {}
  }

  (async function init() {
    try { await loadAll(); } catch (e) { console.error(e); toast('Não consegui carregar os números. Recarregue a página.'); }
    renderSettings();
    buildGrid();
    renderProgress();
    renderWall();
    renderCart();
    bindEvents();
    restoreBuyer();
    subscribeRealtime();
    window.Rifa.initNav();
  })();
})();
