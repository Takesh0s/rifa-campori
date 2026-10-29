// "Meus números": lists the orders saved in this browser. The device keeps only
// opaque tokens; status comes from get_my_orders so it is always current.
(() => {
  'use strict';

  const { DEMO, client, $, esc, brl, listText, fmtDateTime, toast, myOrders } = window.Rifa;

  const STATUS = {
    paid: { label: 'Pago ✅', css: 'paid' },
    pending: { label: 'Reservado ⏳', css: 'pending' },
    expired: { label: 'Reserva expirada', css: 'expired' },
    cancelled: { label: 'Cancelado', css: 'cancelled' },
    conflict: { label: 'Em análise', css: 'conflict' },
  };

  let settings = { whatsapp: '5561984936058', title: 'Rifa Solidária – Campori 2027' };

  const whatsappUrl = (text) => `https://wa.me/${settings.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  async function fetchStatuses(saved) {
    if (DEMO) {
      return saved.map((o) => ({ ...o, status: 'paid', amount: o.numbers.length * 15, created_at: o.createdAt }));
    }
    const [{ data: s }, { data, error }] = await Promise.all([
      client.from('settings').select('whatsapp, title').eq('id', 1).single(),
      client.rpc('get_my_orders', { p_tokens: saved.map((o) => o.token) }),
    ]);
    if (s) settings = s;
    if (error) throw error;

    const byCode = new Map((data || []).map((o) => [o.code, o]));
    // Tokens the server no longer knows (e.g. order deleted) fall back to the local copy.
    return saved.map((local) => ({ ...local, ...(byCode.get(local.code) || { status: 'unknown' }) }));
  }

  function statusDetail(o) {
    if (o.status === 'paid') return `Pago em ${fmtDateTime(o.paid_at || o.created_at)}`;
    if (o.status === 'pending' && o.method === 'in_person') {
      return `Reservado até ${fmtDateTime(o.expires_at)}. Combine o pagamento com o Luiz para garantir.`;
    }
    if (o.status === 'pending') return 'Aguardando a confirmação do Pix.';
    if (o.status === 'expired') return 'O prazo para pagar acabou e os números foram liberados.';
    if (o.status === 'conflict') return 'Recebemos seu pagamento, mas um número precisa ser trocado. O Luiz vai falar com você.';
    if (o.status === 'cancelled') return 'Este pedido foi cancelado.';
    return 'Não encontramos este pedido. Fale com o Luiz se tiver dúvidas.';
  }

  function render(orders) {
    const paidNumbers = orders.filter((o) => o.status === 'paid').flatMap((o) => o.numbers).sort((a, b) => a - b);
    const summary = $('#summary');
    summary.classList.toggle('hidden', paidNumbers.length === 0);
    summary.innerHTML = paidNumbers.length ? `
      <span class="summary-chip">${paidNumbers.length} ${paidNumbers.length === 1 ? 'número garantido' : 'números garantidos'}</span>
      <p style="margin:10px 0 0">Obrigado por ajudar nosso clube a chegar ao Campori! Boa sorte com o${paidNumbers.length > 1 ? 's números' : ' número'} <b>${listText(paidNumbers)}</b> 🍀</p>` : '';

    $('#empty').classList.toggle('hidden', orders.length > 0);
    $('#orders').innerHTML = orders.map((o) => {
      const st = STATUS[o.status] || { label: 'Desconhecido', css: 'cancelled' };
      const wa = o.status === 'pending' && o.method === 'in_person'
        ? whatsappUrl(`Olá, Luiz! 👋 Sobre minha reserva *#${o.code}* da ${settings.title}: números ${listText(o.numbers)}. Como fica melhor pra gente combinar o pagamento?`)
        : null;
      return `
        <article class="card order-card ${st.css}">
          <header>
            <h2 style="margin:0">Pedido #${esc(o.code)}</h2>
            <span class="badge ${st.css === 'conflict' ? 'conflict' : st.css}">${st.label}</span>
          </header>
          <div class="pick-list">${o.numbers.map((n) => `<span>${n}</span>`).join('')}</div>
          <div class="order-meta">${esc(statusDetail(o))}</div>
          <div class="order-meta">${o.amount ? `${brl(o.amount, true)} · ` : ''}${o.method === 'pix' ? '⚡ Pix pelo site' : '🤝 Pagamento em mãos'}</div>
          <div class="row-actions">
            ${wa ? `<a class="btn small whats" href="${wa}" target="_blank" rel="noopener">Falar com o Luiz</a>` : ''}
            <button class="link-btn" type="button" data-remove="${esc(o.token)}">Remover deste aparelho</button>
          </div>
        </article>`;
    }).join('');
  }

  async function load() {
    const saved = myOrders.list();
    $('#emptyWhats').href = whatsappUrl();
    if (!saved.length) return render([]);
    try {
      render(await fetchStatuses(saved));
    } catch (err) {
      console.error(err);
      render(saved.map((o) => ({ ...o, status: 'unknown' })));
      toast('Não consegui atualizar o status agora. Tente de novo em instantes.');
    }
  }

  $('#orders').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    if (!confirm('Remover este pedido da lista deste aparelho? Seus números continuam garantidos no sistema da rifa.')) return;
    myOrders.remove(btn.dataset.remove);
    window.Rifa.initNav();
    load();
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  window.Rifa.initNav();
  load();
})();
