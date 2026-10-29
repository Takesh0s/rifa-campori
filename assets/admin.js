// Admin panel. Access is enforced server-side: RLS exposes `orders` only to
// users listed in `admins`, and every admin_* function re-checks is_admin().
(() => {
  'use strict';
  const { DEMO, client: sb, $, $$, esc, toast } = window.Rifa;

  if (DEMO) {
    $('#loginHint').innerHTML = '⚠️ Preencha <code>assets/config.js</code> com os dados do Supabase para usar o painel.';
    $('#loginForm').querySelector('button').disabled = true;
    return;
  }

  const state = {
    settings: null,
    tickets: new Map(),
    orders: new Map(),
    selected: new Set(),
    filter: 'pending',
    focusOrder: null,
  };

  const brl = (v) => window.Rifa.brl(v, true);
  const fmtDate = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const sortedSel = () => [...state.selected].sort((a, b) => a - b);
  const METHOD = { pix: '⚡ Pix site', in_person: '🤝 Em mãos', manual: '✍️ Manual' };
  const STATUS = { pending: 'Pendente', paid: 'Pago', expired: 'Expirado', cancelled: 'Cancelado', conflict: 'Conflito' };
  const ERR = {
    NUMBERS_TAKEN: 'Algum número já não está livre.', NOT_ADMIN: 'Seu usuário não é administrador.',
    NAME_REQUIRED: 'Informe o nome.',
  };
  const errMsg = (e) => ERR[Object.keys(ERR).find((k) => e?.message?.includes(k))] || e?.message || 'Erro';

  function effectiveStatus(t) {
    if (!t) return 'available';
    if (t.status === 'reserved' && t.reserved_until && new Date(t.reserved_until) < new Date()) return 'available';
    return t.status;
  }

  function waLink(phone, text = '') {
    const d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    const full = d.length <= 11 ? `55${d}` : d;
    return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#lEmail').value, password: $('#lPass').value });
    if (error) $('#loginError').textContent = 'E-mail ou senha incorretos.';
  });
  $('#logoutBtn').addEventListener('click', () => sb.auth.signOut());

  // supabase-js deadlocks if other client calls are awaited inside this callback; defer them.
  sb.auth.onAuthStateChange((_evt, session) => { setTimeout(() => (session ? enter(session) : leave()), 0); });

  let entered = false;
  async function enter(session) {
    if (entered) return;
    const { data } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (!data) {
      $('#loginError').textContent = 'Este usuário não está na tabela admins (veja o README, passo 2.5).';
      await sb.auth.signOut();
      return;
    }
    entered = true;
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    await loadAll();
    buildGrid();
    renderAll();
    subscribe();
    document.dispatchEvent(new CustomEvent('rifa:admin-ready', { detail: { settings: state.settings } }));
  }
  function leave() {
    entered = false;
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
  }

  async function loadAll() {
    await sb.rpc('release_expired');
    const [s, t, o] = await Promise.all([
      sb.from('settings').select('*').eq('id', 1).single(),
      sb.from('tickets').select('*').order('number'),
      sb.from('orders').select('*').order('created_at', { ascending: false }),
    ]);
    state.settings = s.data;
    state.tickets = new Map((t.data || []).map((x) => [x.number, x]));
    state.orders = new Map((o.data || []).map((x) => [x.id, x]));
  }

  function subscribe() {
    sb.channel('rifa-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, ({ new: t }) => {
        if (t?.number) { state.tickets.set(t.number, t); updateCell(t.number); renderStats(); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, ({ eventType, new: o }) => {
        if (!o?.id) return;
        const isNew = !state.orders.has(o.id);
        state.orders.set(o.id, o);
        if (isNew && eventType === 'INSERT' && o.method !== 'manual') toast(`🔔 Novo pedido de ${o.buyer_name}: ${o.numbers.join(', ')}`);
        if (eventType === 'UPDATE' && o.status === 'paid' && o.method === 'pix') toast(`💸 Pix confirmado: ${o.buyer_name}`);
        renderOrders(); renderStats(); refreshSide();
        o.numbers.forEach(updateCell);
      })
      .subscribe();
  }

  function buildGrid() {
    const grid = $('#adminGrid');
    grid.innerHTML = '';
    for (let n = 1; n <= state.settings.total_numbers; n++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'num'; b.dataset.n = n;
      grid.appendChild(b);
    }
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.num'); if (!b) return;
      const n = Number(b.dataset.n);
      const t = state.tickets.get(n);
      if (effectiveStatus(t) === 'available') {
        state.focusOrder = null;
        state.selected.has(n) ? state.selected.delete(n) : state.selected.add(n);
        updateCell(n);
      } else {
        clearSelection();
        state.focusOrder = t.order_id;
      }
      refreshSide();
    });
    for (let n = 1; n <= state.settings.total_numbers; n++) updateCell(n);
  }

  function updateCell(n) {
    const b = $(`#adminGrid .num[data-n="${n}"]`); if (!b) return;
    const t = state.tickets.get(n);
    const st = effectiveStatus(t);
    const o = t?.order_id ? state.orders.get(t.order_id) : null;
    const who = st !== 'available' && o ? (o.public_name || o.buyer_name.split(' ')[0]) : '';
    b.className = 'num' + (st !== 'available' ? ` ${st}` : '') + (state.selected.has(n) ? ' selected' : '');
    b.innerHTML = `${n}${who ? `<span class="who">${esc(who)}</span>` : ''}`;
    b.title = o ? `${o.buyer_name} · ${STATUS[o.status]}` : 'Livre';
    const q = $('#searchName').value.trim().toLowerCase();
    b.classList.toggle('hl', !!q && !!o && `${o.buyer_name} ${o.public_name || ''} ${o.code}`.toLowerCase().includes(q));
  }

  function clearSelection() {
    const prev = [...state.selected]; state.selected.clear(); prev.forEach(updateCell);
  }

  $('#searchName').addEventListener('input', () => {
    for (let n = 1; n <= state.settings.total_numbers; n++) updateCell(n);
  });

  function refreshSide() {
    const sel = sortedSel();
    $('#sideEmpty').classList.toggle('hidden', sel.length > 0 || !!state.focusOrder);
    $('#saleForm').classList.toggle('hidden', sel.length === 0);
    $('#orderDetail').classList.toggle('hidden', !state.focusOrder || sel.length > 0);
    if (sel.length) {
      $('#salePick').innerHTML = sel.map((n) => `<span>${n}</span>`).join('');
      $('#saleTotal').textContent = `${sel.length} número(s) · ${brl(sel.length * state.settings.ticket_price)}`;
    }
    if (state.focusOrder && !sel.length) renderOrderDetail(state.orders.get(state.focusOrder));
  }

  function renderOrderDetail(o) {
    const el = $('#orderDetail');
    if (!o) { el.innerHTML = '<p class="muted">Pedido não encontrado.</p>'; return; }
    const wa = waLink(o.buyer_phone, `Olá, ${o.buyer_name.split(' ')[0]}! Aqui é o Luiz, da Rifa do Campori ⛺`);
    el.innerHTML = `
      <h2>Pedido #${esc(o.code)}</h2>
      <p style="margin:0"><span class="badge ${o.status}">${STATUS[o.status]}</span> <span class="muted">${METHOD[o.method]}</span></p>
      <div class="pick-list">${o.numbers.map((n) => `<span>${n}</span>`).join('')}</div>
      <p style="margin:0 0 4px"><b>${esc(o.buyer_name)}</b></p>
      <p class="muted" style="margin:0 0 4px">Mural: ${o.show_on_wall ? esc(o.public_name || o.buyer_name.split(' ')[0]) : '(oculto)'}</p>
      ${o.buyer_phone ? `<p style="margin:0 0 4px">📱 ${esc(o.buyer_phone)}</p>` : ''}
      ${o.buyer_email ? `<p style="margin:0 0 4px">✉️ ${esc(o.buyer_email)}</p>` : ''}
      <p style="margin:0 0 4px">💰 ${brl(o.amount)} · criado ${fmtDate(o.created_at)}</p>
      ${o.status === 'pending' && o.expires_at ? `<p style="margin:0 0 4px">⏳ Reserva até ${fmtDate(o.expires_at)}</p>` : ''}
      ${o.paid_at ? `<p style="margin:0 0 4px">✅ Pago ${fmtDate(o.paid_at)}</p>` : ''}
      ${o.mp_payment_id ? `<p style="margin:0 0 4px" class="muted">MP: ${esc(o.mp_payment_id)}</p>` : ''}
      ${o.notes ? `<p style="margin:0 0 4px" class="muted">📝 ${esc(o.notes)}</p>` : ''}
      <div class="row-actions" style="margin-top:12px">
        ${['pending', 'conflict', 'expired'].includes(o.status) ? `<button class="btn small green" data-act="confirm" data-id="${o.id}">✓ Confirmar pagamento</button>` : ''}
        ${wa ? `<a class="btn small whats" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn small ghost" data-act="rename" data-id="${o.id}">✏️ Nome no mural</button>
        ${o.status !== 'cancelled' ? `<button class="btn small ghost" data-act="cancel" data-id="${o.id}">✕ Cancelar pedido</button>` : ''}
      </div>
      ${o.status !== 'cancelled' && o.numbers.length > 1 ? `
        <details style="margin-top:12px"><summary class="muted">Liberar só alguns números</summary>
          <div class="row-actions" style="margin-top:8px">${o.numbers.map((n) => `<button class="btn small ghost" data-act="release" data-n="${n}">Liberar ${n}</button>`).join('')}</div>
        </details>` : ''}`;
  }

  $('#saleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#saleError').textContent = '';
    const nums = sortedSel();
    const { error } = await sb.rpc('admin_register_sale', {
      p_numbers: nums, p_name: $('#sName').value, p_public_name: $('#sPublic').value || null,
      p_phone: $('#sPhone').value.replace(/\D/g, '') || null, p_show: $('#sShow').checked,
      p_notes: $('#sNotes').value || null,
    });
    if (error) { $('#saleError').textContent = errMsg(error); return; }
    toast(`✓ Venda registrada: ${nums.join(', ')}`);
    e.target.reset(); $('#sShow').checked = true;
    clearSelection(); refreshSide();
    await reloadOrdersAndTickets();
  });
  $('#saleCancel').addEventListener('click', () => { clearSelection(); refreshSide(); });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const { act, id } = btn.dataset;
    const o = id ? state.orders.get(id) : null;
    let error;
    if (act === 'confirm') {
      if (!confirm(`Confirmar pagamento de ${o.buyer_name} (${brl(o.amount)})?`)) return;
      const r = await sb.rpc('admin_confirm_order', { p_order_id: id });
      error = r.error;
      if (!error && r.data === 'conflict') toast('⚠️ Algum número já é de outra pessoa. Libere/troque antes de confirmar.');
      else if (!error) toast('✓ Pagamento confirmado');
    } else if (act === 'cancel') {
      if (!confirm(`Cancelar o pedido #${o.code} e liberar ${o.numbers.join(', ')}?`)) return;
      ({ error } = await sb.rpc('admin_cancel_order', { p_order_id: id }));
      if (!error) toast('Pedido cancelado, números liberados');
    } else if (act === 'release') {
      const n = Number(btn.dataset.n);
      if (!confirm(`Liberar o número ${n}?`)) return;
      ({ error } = await sb.rpc('admin_release_numbers', { p_numbers: [n] }));
      if (!error) toast(`Número ${n} liberado`);
    } else if (act === 'rename') {
      const name = prompt('Nome que aparece no mural (deixe vazio para ocultar):', o.public_name || o.buyer_name.split(' ')[0]);
      if (name === null) return;
      ({ error } = await sb.from('orders').update({ public_name: name.trim() || null, show_on_wall: !!name.trim() }).eq('id', id));
      if (!error) toast('Mural atualizado');
    } else return;
    if (error) return toast(`Erro: ${errMsg(error)}`);
    await reloadOrdersAndTickets();
  });

  async function reloadOrdersAndTickets() {
    await loadAll();
    renderAll();
  }

  $$('#orderFilters [data-filter]').forEach((b) => b.addEventListener('click', () => {
    $$('#orderFilters [data-filter]').forEach((x) => x.classList.toggle('active', x === b));
    state.filter = b.dataset.filter; renderOrders();
  }));

  function renderOrders() {
    const list = [...state.orders.values()]
      .filter((o) => state.filter === 'all' || o.status === state.filter)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    $('#ordersBody').innerHTML = list.length ? list.map((o) => {
      const wa = waLink(o.buyer_phone);
      return `<tr>
        <td><b>#${esc(o.code)}</b></td>
        <td>${esc(o.buyer_name)}${o.buyer_phone ? `<br><small class="muted">${esc(o.buyer_phone)}</small>` : ''}</td>
        <td>${o.numbers.join(', ')}</td>
        <td>${brl(o.amount)}</td>
        <td>${METHOD[o.method]}</td>
        <td><span class="badge ${o.status}">${STATUS[o.status]}</span></td>
        <td><small>${fmtDate(o.created_at)}</small></td>
        <td><div class="row-actions">
          ${['pending', 'conflict', 'expired'].includes(o.status) ? `<button class="btn small green" data-act="confirm" data-id="${o.id}">✓ Pago</button>` : ''}
          ${wa ? `<a class="btn small whats" href="${wa}" target="_blank" rel="noopener">💬</a>` : ''}
          ${o.status !== 'cancelled' ? `<button class="btn small ghost" data-act="cancel" data-id="${o.id}" title="Cancelar">✕</button>` : ''}
        </div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="muted">Nada por aqui.</td></tr>';
    const pend = [...state.orders.values()].filter((o) => o.status === 'pending' || o.status === 'conflict').length;
    $('#pendingBadge').textContent = pend ? `(${pend})` : '';
  }

  $('#exportBtn').addEventListener('click', () => {
    const rows = [['numero', 'comprador', 'nome_mural', 'telefone', 'email', 'forma', 'status', 'pedido', 'pago_em']];
    const byNumber = [];
    for (const o of state.orders.values()) {
      if (o.status !== 'paid') continue;
      o.numbers.forEach((n) => byNumber.push([n, o.buyer_name, o.public_name || '', o.buyer_phone || '', o.buyer_email || '', METHOD[o.method], o.status, o.code, o.paid_at || '']));
    }
    byNumber.sort((a, b) => a[0] - b[0]);
    const csv = rows.concat(byNumber).map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `rifa-campori-vendidos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  function renderStats() {
    let paid = 0, reserved = 0;
    for (const t of state.tickets.values()) {
      const st = effectiveStatus(t); if (st === 'paid') paid++; else if (st === 'reserved') reserved++;
    }
    const s = state.settings;
    const orders = [...state.orders.values()].filter((o) => o.status === 'paid');
    const pixTotal = orders.filter((o) => o.method === 'pix').reduce((a, o) => a + Number(o.amount), 0);
    const buyers = new Set(orders.map((o) => o.buyer_name.trim().toLowerCase())).size;
    $('#stats').innerHTML = `
      <div class="stat"><b>${brl(paid * s.ticket_price)}</b><span>arrecadado (meta ${brl(s.goal_amount)})</span></div>
      <div class="stat"><b>${paid}</b><span>números pagos</span></div>
      <div class="stat"><b>${reserved}</b><span>reservados aguardando</span></div>
      <div class="stat"><b>${s.total_numbers - paid - reserved}</b><span>livres</span></div>
      <div class="stat"><b>${buyers}</b><span>compradores</span></div>
      <div class="stat"><b>${brl(pixTotal)}</b><span>via Pix do site</span></div>`;
  }

  function fillSettings() {
    const f = $('#settingsForm');
    const s = state.settings;
    [...f.elements].forEach((el) => {
      if (!el.name) return;
      if (el.type === 'checkbox') el.checked = !!s[el.name];
      else el.value = s[el.name] ?? '';
    });
    $('#fixedPrice').textContent = Number(s.ticket_price).toFixed(2).replace('.', ',');
    $('#fixedTotal').textContent = s.total_numbers;
  }
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    [...e.target.elements].forEach((el) => {
      if (!el.name) return;
      if (el.type === 'checkbox') patch[el.name] = el.checked;
      else if (el.type === 'number') patch[el.name] = Number(el.value);
      else if (el.name === 'draw_info') patch[el.name] = el.value.trim() || null;
      else if (el.value.trim()) patch[el.name] = el.value.trim();
    });
    const { error } = await sb.from('settings').update(patch).eq('id', 1);
    $('#settingsSaved').textContent = error ? `Erro: ${error.message}` : 'Salvo ✓';
    if (!error) { state.settings = { ...state.settings, ...patch }; renderStats(); }
    setTimeout(() => { $('#settingsSaved').textContent = ''; }, 3000);
  });

  $$('.tabs .tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== t.dataset.tab));
  }));

  function renderAll() {
    for (let n = 1; n <= state.settings.total_numbers; n++) updateCell(n);
    renderStats(); renderOrders(); fillSettings(); refreshSide();
  }
})();
