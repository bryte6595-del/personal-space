// Page frame: login screen, sidebar, top bar and the functions that show or hide them.
import { dom, ps, titles } from './state.js';
import { $, $$, esc, initials } from './utils.js';

export function setAuthMessage(message, isError = false) {
  const el = $('#auth-message');
  el.textContent = message || '';
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}
export function setAuthTab(tab) {
  $$('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.authTab === tab));
  $('#login-form').hidden = tab !== 'login';
  $('#register-form').hidden = tab !== 'register';
  setAuthMessage('');
}
export function showAuth(tab = 'login') { hideBoot(); dom.authScreen.hidden = false; dom.app.hidden = true; setAuthTab(tab); }
export function showApp() { hideBoot(); dom.authScreen.hidden = true; dom.app.hidden = false; }
export function updateIdentity() {
  const name = ps.currentProfile?.display_name || ps.currentUser?.user_metadata?.display_name || 'Your name';
  const username = ps.currentProfile?.username || ps.currentUser?.user_metadata?.username || 'username';
  $('#side-name').textContent = name;
  $('#side-handle').textContent = '@' + username;
  $('#side-avatar').textContent = initials(name);
  if (ps.currentProfile?.avatar_url) $('#side-avatar').innerHTML = `<img src="${esc(ps.currentProfile.avatar_url)}" alt="">`;
}
export function openMobileSidebar() {
  $('#sidebar').classList.add('mobile-open');
  $('#sidebar-backdrop').hidden = false;
  $('#mobile-menu').setAttribute('aria-expanded', 'true');
}
export function closeMobileSidebar() {
  $('#sidebar').classList.remove('mobile-open');
  $('#sidebar-backdrop').hidden = true;
  $('#mobile-menu').setAttribute('aria-expanded', 'false');
}
export function toggleMobileSidebar() {
  if ($('#sidebar').classList.contains('mobile-open')) closeMobileSidebar();
  else openMobileSidebar();
}
// The page frame (login screen, sidebar, top bar) is built here once, so every page file stays tiny.
// To add a section to the sidebar, add one line to NAV and one page file.
const NAV = [
  ['GENERAL', [['home', 'index.html', '⌂', 'Home'], ['profile', 'profile.html', '◉', 'My profile'], ['posts', 'posts.html', '▤', 'Posts'], ['friends', 'friends.html', '♧', 'Friends & followers'], ['messages', 'chats.html', '✉', 'Chats']]],
  ['MEDIA', [['images', 'media.html?type=images', '▧', 'Images'], ['videos', 'media.html?type=videos', '▷', 'Videos'], ['audio', 'media.html?type=audio', '♫', 'Audio']]],
  ['PERSONAL', [['projects', 'projects.html', '⌘', 'Projects & games'], ['movies', 'movies.html', '▣', 'Movies'], ['recommendations', 'recommendations.html', '↗', 'Recommendations']]],
  ['ACCOUNT', [['settings', 'settings.html', '⚙', 'Settings']]]
];
function navMarkup() {
  const activeView = ps.currentView === 'public-profile' ? 'profile' : ps.currentView;
  return NAV.map(([heading, items]) => `<p class="nav-heading">${esc(heading)}</p>` + items.map(([view, href, icon, label]) =>
    `<a href="${esc(href)}" class="nav-link${view === activeView ? ' active' : ''}" data-view="${view}"><span class="nav-icon">${icon}</span><span>${esc(label)}</span></a>`).join('')).join('');
}
export function renderShell() {
  document.body.insertAdjacentHTML('afterbegin', `
  <div id="auth-screen" class="auth-screen" hidden>
    <section class="auth-panel">
      <p class="eyebrow">YOUR CORNER OF THE INTERNET</p>
      <h1>Personal Space</h1>
      <p class="muted">A place for your thoughts, projects, media and people.</p>
      <div id="setup-notice" class="notice" hidden>
        <strong>Backend setup required</strong>
        <p>This project is ready for Supabase, but it is not connected yet. Add your project URL and public anon key in <code>js/config.js</code>, then run the database script in <code>supabase/schema.sql</code>.</p>
      </div>
      <div class="auth-tabs" role="tablist" aria-label="Account access">
        <button class="auth-tab active" data-auth-tab="login" type="button">Log in</button>
        <button class="auth-tab" data-auth-tab="register" type="button">Create account</button>
      </div>
      <form id="login-form" class="form-stack">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
        <button class="button primary" type="submit">Log in</button>
        <button class="text-button" id="forgot-password" type="button">Forgot password?</button>
      </form>
      <form id="register-form" class="form-stack" hidden>
        <label>Display name<input name="display_name" autocomplete="name" required maxlength="60"></label>
        <label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+"><small>Letters, numbers and underscores only.</small></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="button primary" type="submit">Create account</button>
      </form>
      <p id="auth-message" class="form-message" role="status"></p>
      <p class="tiny muted">Your account and content require a connected backend. This starter does not store passwords locally.</p>
    </section>
  </div>

  <div id="app" class="app-shell" hidden>
    <aside id="sidebar" class="sidebar">
      <div class="brand-row"><a class="brand" href="index.html" data-view="home">PERSONAL SPACE</a><div class="sidebar-head-actions"><button id="collapse-sidebar" class="icon-button desktop-collapse" type="button" aria-label="Collapse sidebar" title="Collapse sidebar">‹</button><button id="close-mobile-sidebar" class="icon-button mobile-sidebar-close" type="button" aria-label="Close navigation" title="Close navigation">×</button></div></div>
      <div class="side-profile"><div class="avatar" id="side-avatar">?</div><div class="side-profile-text"><strong id="side-name">Your name</strong><span id="side-handle">@username</span></div></div>
      <nav class="navigation" aria-label="Main navigation">${navMarkup()}</nav>
      <button id="logout-button" class="logout-button" type="button">↪ <span>Log out</span></button>
    </aside>
    <div id="sidebar-backdrop" class="sidebar-backdrop" hidden></div>

    <main class="main-area">
      <header class="topbar"><button id="mobile-menu" class="icon-button mobile-menu" type="button" aria-label="Open navigation" aria-expanded="false" title="Open navigation">☰</button><div class="breadcrumb" id="breadcrumb">${esc(titles[ps.currentView] || 'Home')}</div><div class="topbar-actions"><button id="theme-toggle" class="icon-button topbar-icon" type="button" aria-label="Switch to dark theme" data-tooltip="Dark theme" title="Dark theme"><span class="theme-icon" aria-hidden="true">☾</span></button></div></header>
      <div id="app-notice" class="app-notice" hidden></div>
      <section id="view-container" class="view-container" aria-live="polite"></section>
    </main>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>`);
}
function hideBoot() { const boot = document.getElementById('boot'); if (boot) boot.remove(); }
