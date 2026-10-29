// Loaded synchronously in <head> so the saved theme is applied before first
// paint. Inline scripts are blocked by the CSP, hence a separate file.
(() => {
  'use strict';
  const KEY = 'rifa:theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;

  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const resolve = () => saved() || (media.matches ? 'dark' : 'light');

  function apply(theme) {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#15120f' : '#f4e8cf';
  }

  apply(resolve());
  // Follow the OS only while the user has not picked a theme explicitly.
  media.addEventListener('change', () => { if (!saved()) apply(resolve()); });

  window.RifaTheme = {
    current: () => root.dataset.theme,
    toggle() {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
      apply(next);
      return next;
    },
  };
})();
