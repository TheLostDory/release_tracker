// Applies the saved theme before first paint (no light flash in dark mode).
// External file because the CSP forbids inline scripts. Keep in sync with src/lib/theme.ts.
;(function () {
  try {
    var pref = localStorage.getItem('release-tracker:theme')
    var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    var root = document.documentElement
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
  } catch {
    /* storage blocked: fall back to light */
  }
})()
