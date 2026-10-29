// Helpers shared by every public page and the admin panel.
window.Rifa = (() => {
  'use strict';

  const CFG = window.RIFA_CONFIG;
  const DEMO = window.RIFA_DEMO;
  const ORDERS_KEY = 'rifa:orders';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Whole reais render without cents ("R$ 15"); pass cents=true for checkout totals.
  const brl = (value, cents = false) => Number(value).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: cents || value % 1 ? 2 : 0, maximumFractionDigits: 2,
  });

  const listText = (nums) => (nums.length <= 1 ? String(nums[0] ?? '')
    : `${nums.slice(0, -1).join(', ')} e ${nums[nums.length - 1]}`);

  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '');

  function toast(message) {
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  const client = DEMO ? null : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  // Orders bought on this device. Only the opaque token, code and numbers are
  // kept here; the status is always re-read from the server.
  const myOrders = {
    list() {
      try {
        const raw = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((o) => o && typeof o.token === 'string') : [];
      } catch {
        return [];
      }
    },
    save(list) {
      try { localStorage.setItem(ORDERS_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* storage full or disabled */ }
    },
    add(order) {
      if (!order?.accessToken) return;
      const list = myOrders.list().filter((o) => o.token !== order.accessToken);
      list.unshift({
        token: order.accessToken,
        code: order.code,
        numbers: order.numbers,
        method: order.method,
        createdAt: new Date().toISOString(),
      });
      myOrders.save(list);
    },
    remove(token) {
      myOrders.save(myOrders.list().filter((o) => o.token !== token));
    },
  };

  // Nav badge and gallery link are shared by all public pages.
  async function initNav() {
    const count = myOrders.list().length;
    const badge = $('#navMyCount');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
    const galleryLink = $('#navGallery');
    if (!galleryLink || DEMO) return;
    const { data } = await client.from('settings').select('gallery_enabled').eq('id', 1).single();
    galleryLink.classList.toggle('hidden', !data?.gallery_enabled);
  }

  return { CFG, DEMO, client, $, $$, esc, brl, listText, fmtDateTime, toast, myOrders, initNav };
})();
