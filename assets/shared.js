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

  const ICONS = {
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
    list: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  };
  const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const PAGES = [
    { id: 'rifa', href: '/', label: 'Rifa', icon: 'ticket' },
    { id: 'meus', href: '/meus-numeros', label: 'Meus números', short: 'Meus números', icon: 'list', badge: true },
    { id: 'galeria', href: '/galeria', label: 'Memórias', icon: 'image', gallery: true },
  ];

  // Renders the top app bar (all sizes) and the bottom tab bar (phones) into
  // <nav id="appNav" data-current="...">, so every page shares one menu.
  function renderNav() {
    const host = $('#appNav');
    if (!host) return;
    const current = host.dataset.current;
    const link = (p, cls) => `
      <a href="${p.href}" class="${cls}${p.gallery ? ' nav-gallery hidden' : ''}"${p.id === current ? ' aria-current="page"' : ''}>
        ${icon(p.icon)}<span>${p.short || p.label}</span>${p.badge ? '<span class="nav-badge nav-my-count hidden"></span>' : ''}
      </a>`;

    host.innerHTML = `
      <div class="appbar">
        <a class="brand" href="/" aria-label="Início"><img src="/assets/icons/icon-192.png" alt="" width="32" height="32"><span>Rifa Campori</span></a>
        <div class="appbar-links">${PAGES.map((p) => link(p, 'navlink')).join('')}</div>
        <div class="appbar-actions">
          <button class="icon-btn install-btn hidden" type="button" aria-label="Instalar app">${icon('download')}<span>Instalar</span></button>
          <button class="icon-btn theme-btn" type="button" aria-label="Alternar modo escuro"></button>
        </div>
      </div>
      <div class="tabbar" role="navigation" aria-label="Seções">${PAGES.map((p) => link(p, 'tab-link')).join('')}</div>`;

    const themeBtn = $('.theme-btn', host);
    const paintTheme = () => {
      const dark = window.RifaTheme?.current() === 'dark';
      themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
      themeBtn.title = dark ? 'Modo claro' : 'Modo escuro';
    };
    paintTheme();
    themeBtn.addEventListener('click', () => { window.RifaTheme?.toggle(); paintTheme(); });
    setupInstall(host);
  }

  // PWA install: Chrome/Edge/Android fire beforeinstallprompt; iOS Safari has no
  // install API, so the button opens instructions instead.
  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function setupInstall(host) {
    const buttons = () => $$('.install-btn', host);
    const show = (on) => buttons().forEach((b) => b.classList.toggle('hidden', !on || isStandalone()));

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      show(true);
    });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; show(false); toast('App instalado! ⛺'); });
    if (isIos()) show(true);

    buttons().forEach((b) => b.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        show(false);
      } else {
        showIosHelp();
      }
    }));
  }

  function showIosHelp() {
    let dlg = $('#installHelp');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'installHelp';
      dlg.className = 'modal';
      dlg.innerHTML = `
        <div class="modal-body center">
          <div class="big-emoji">📲</div>
          <h3>Instalar no iPhone</h3>
          <p>No <b>Safari</b>, toque em <b>Compartilhar</b> (o quadrado com a seta para cima) e depois em <b>Adicionar à Tela de Início</b>.</p>
          <button class="btn primary" type="button">Entendi</button>
        </div>`;
      dlg.querySelector('button').addEventListener('click', () => dlg.close());
      document.body.appendChild(dlg);
    }
    dlg.showModal();
  }

  async function initNav() {
    const count = myOrders.list().length;
    $$('.nav-my-count').forEach((badge) => {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    });
    if (DEMO) return;
    const { data } = await client.from('settings').select('gallery_enabled').eq('id', 1).single();
    setGalleryVisible(!!data?.gallery_enabled);
  }

  const setGalleryVisible = (on) => {
    $$('.nav-gallery').forEach((a) => a.classList.toggle('hidden', !on && a.getAttribute('aria-current') !== 'page'));
  };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  renderNav();

  return { CFG, DEMO, client, $, $$, esc, brl, listText, fmtDateTime, toast, myOrders, initNav, setGalleryVisible };
})();
