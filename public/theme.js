(() => {
  let preference;
  try { preference = localStorage.getItem('mailroom-theme'); } catch { /* private browsing */ }
  const theme = ['light', 'dark'].includes(preference) ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
