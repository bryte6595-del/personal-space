// Runs before the page paints so the chosen theme never flashes. Keep in sync with modules/theme.js.
(function () {
  try {
    var root = document.documentElement;
    var mode = localStorage.getItem('ps-mode');
    var accent = localStorage.getItem('ps-accent');
    if (!mode) mode = localStorage.getItem('ps-theme') === 'dark' ? 'dark' : 'light';
    if (['light', 'dark', 'auto'].indexOf(mode) < 0) mode = 'light';
    if (['teal', 'blue', 'purple', 'green', 'warm', 'rose'].indexOf(accent) < 0) accent = 'teal';
    var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.mode = dark ? 'dark' : 'light';
    root.dataset.pref = mode;
    root.dataset.accent = accent;
  } catch (e) { /* storage blocked: defaults apply */ }
})();
