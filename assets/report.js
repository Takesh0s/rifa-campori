// Buyer list for raffle control and for printing on draw day. Reading `orders`
// requires an admin session (RLS), so this page works only after logging in at /admin.
(() => {
  'use strict';

  const { client: sb, $, esc, brl } = window.Rifa;
  const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  let data = null;

  async function load() {
    const { data: session } = await sb.auth.getSession();
    const userId = session?.session?.user?.id;
    const { data: admin } = userId
      ? await sb.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
      : { data: null };
    if (!admin) {
      $('#denied').classList.remove('hidden');
      document.querySelector('.report-actions').classList.add('hidden');
      return;
    }

    await sb.rpc('release_expired');
    const [s, o] = await Promise.all([
      sb.from('settings').select('title, ticket_price, total_numbers').eq('id', 1).single(),
      sb.from('orders').select('buyer_name, buyer_phone, numbers, status, created_at')
        .in('status', ['paid', 'pending', 'conflict']),
    ]);
    data = { settings: s.data, orders: o.data || [] };
    render();
    $('#report').classList.remove('hidden');
  }

  function render() {
    const { settings, orders: all } = data;
    const includePending = $('#withPending').checked;
    const orders = all.filter((o) => includePending || o.status === 'paid');

    const byNumber = new Map();
    orders.forEach((o) => o.numbers.forEach((n) => byNumber.set(n, o)));
    const paidCount = all.filter((o) => o.status === 'paid').reduce((sum, o) => sum + o.numbers.length, 0);
    const pendingCount = all.filter((o) => o.status !== 'paid').reduce((sum, o) => sum + o.numbers.length, 0);
    const free = [];
    for (let n = 1; n <= settings.total_numbers; n++) {
      if (!all.some((o) => o.numbers.includes(n))) free.push(n);
    }

    $('#rTitle').textContent = settings.title;
    $('#rMeta').textContent = `Relação de números e compradores · atualizada em ${fmt(new Date().toISOString())}`;
    $('#rStamp').textContent = fmt(new Date().toISOString());
    $('#rStats').innerHTML = `
      <div class="stat"><b>${paidCount}</b><span>números pagos</span></div>
      <div class="stat"><b>${pendingCount}</b><span>reservados a pagar</span></div>
      <div class="stat"><b>${free.length}</b><span>livres</span></div>
      <div class="stat"><b>${brl(paidCount * settings.ticket_price, true)}</b><span>arrecadado</span></div>`;

    $('#byNumber').innerHTML = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([n, o]) => `
      <div class="report-row${o.status === 'paid' ? '' : ' pending'}">
        <b>${String(n).padStart(3, '0')}</b><span>${esc(o.buyer_name)}</span>${o.status === 'paid' ? '' : '<em>a pagar</em>'}
      </div>`).join('') || '<p class="muted">Nenhum número vendido ainda.</p>';
    $('#freeList').textContent = free.length ? `Livres (${free.length}): ${free.join(', ')}` : 'Todos os números foram vendidos!';

    // One row per person; the same name across several orders is merged.
    const people = new Map();
    orders.forEach((o) => {
      const key = o.buyer_name.trim().toLowerCase();
      const p = people.get(key) || { name: o.buyer_name.trim(), phone: o.buyer_phone, paid: [], pending: [] };
      (o.status === 'paid' ? p.paid : p.pending).push(...o.numbers);
      if (!p.phone && o.buyer_phone) p.phone = o.buyer_phone;
      people.set(key, p);
    });
    $('#byPerson').innerHTML = [...people.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((p) => {
        const nums = [...p.paid, ...p.pending].sort((a, b) => a - b);
        const status = p.pending.length ? (p.paid.length ? 'Parte a pagar' : 'A pagar') : 'Pago';
        return `<tr class="${p.pending.length ? 'pending' : ''}">
          <td>${esc(p.name)}</td>
          <td class="phone-col">${esc(formatPhone(p.phone))}</td>
          <td>${nums.length}</td>
          <td>${nums.join(', ')}</td>
          <td><span class="badge ${p.pending.length ? 'pending' : 'paid'}">${status}</span></td>
        </tr>`;
      }).join('');
    document.body.classList.toggle('hide-phones', !$('#withPhones').checked);
  }

  function formatPhone(digits) {
    const d = String(digits || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  }

  $('#withPhones').addEventListener('change', render);
  $('#withPending').addEventListener('change', render);
  $('#printBtn').addEventListener('click', () => window.print());
  load();
})();
