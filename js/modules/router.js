// Moves between sections (go) and draws the current one (renderView).
import { renderChats } from './chats.js';
import { renderCollection, renderMedia } from './collections.js';
import { renderFriends } from './friends.js';
import { renderHome, renderPosts } from './posts.js';
import { loadProfile, renderProfile, renderPublicProfile } from './profile.js';
import { pageRoutes } from './routes.js';
import { renderSettings } from './settings.js';
import { closeMobileSidebar, showAuth } from './shell.js';
import { dom, ps, titles } from './state.js';
import { $, $$, errorText, esc, pageHead } from './utils.js';

export async function go(view, options = {}) {
  const nextView = view in titles ? view : 'home';
  const route = pageRoutes[nextView] || 'index.html';
  const params = new URLSearchParams();
  if (nextView === 'public-profile' && ps.viewedProfileId) params.set('member', ps.viewedProfileId);
  if (nextView === 'messages' && options.chat) params.set('chat', options.chat);
  if (['images','videos','audio'].includes(nextView)) params.set('type', nextView);
  const query = params.toString();
  const target = route + (query ? '?' + query : '');
  const currentPath = location.pathname.split('/').pop() || 'index.html';
  const currentQuery = location.search.replace(/^\?/, '');
  if (currentPath !== route || currentQuery !== query) {
    window.location.assign(target);
    return;
  }
  if (nextView === 'messages' && ps.currentView !== 'messages' && !options.chat) ps.activeChatUser = null;
  ps.currentView = nextView;
  if (nextView === 'messages' && options.chat) ps.activeChatUser = options.chat;
  if (nextView === 'public-profile') ps.viewedProfileId = params.get('member');
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === ps.currentView));
  $('#breadcrumb').textContent = titles[ps.currentView];
  closeMobileSidebar();
  await renderView();
}
export async function renderView() {
  document.title = `${titles[ps.currentView] || 'Home'} | Personal Space`;
  if (!ps.currentUser) return showAuth();
  const token = ++ps.renderToken;
  dom.viewContainer.classList.remove('messages-view', 'has-active-chat', 'home-view');
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === ps.currentView || (ps.currentView === 'public-profile' && a.dataset.view === 'profile')));
  $('#breadcrumb').textContent = titles[ps.currentView] || 'Home';
  dom.viewContainer.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await loadProfile();
    if (token !== ps.renderToken) return;
    const pages = { home: renderHome, profile: renderProfile, 'public-profile': renderPublicProfile, posts: renderPosts, friends: renderFriends, messages: renderChats, images: () => renderMedia('image'), videos: () => renderMedia('video'), audio: () => renderMedia('audio'), projects: () => renderCollection('projects'), movies: () => renderCollection('movies'), recommendations: () => renderCollection('recommendations'), settings: renderSettings };
    await (pages[ps.currentView] || renderHome)();
  } catch (error) {
    if (token === ps.renderToken) dom.viewContainer.innerHTML = pageHead(titles[ps.currentView], 'We could not load this section.') + `<p class="error-text">${esc(errorText(error))}</p><button class="button" data-action="retry">Try again</button>`;
  }
}
