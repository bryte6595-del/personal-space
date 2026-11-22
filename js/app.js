import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const authScreen = $('#auth-screen');
const app = $('#app');
const viewContainer = $('#view-container');
const titles = { home:'Home', profile:'My profile', 'public-profile':'Member profile', posts:'Posts', friends:'Friends & followers', messages:'Messages', images:'Images', videos:'Videos', audio:'Audio', projects:'Projects & games', movies:'Movies', recommendations:'Recommendations', settings:'Settings' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeHttpUrl(value) { try { const url = new URL(String(value), location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
let supabase;
let currentUser = null;
let currentProfile = null;
let currentView = 'home';
let activeChatUser = null;
let chatProfiles = {};
let viewedProfileId = null;
let renderToken = 0;
let realtimeChannel = null;
let realtimeRefreshTimer = null;
let notificationPanelOpen = false;
let notificationRefreshTimer = null;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 3500);
}
function setAuthMessage(message, isError = false) {
  const el = $('#auth-message');
  el.textContent = message || '';
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}
function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = label || 'Please wait…'; }
  else { button.disabled = false; button.textContent = button.dataset.originalText || 'Submit'; }
}
function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?'; }
function setAuthTab(tab) {
  $$('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.authTab === tab));
  $('#login-form').hidden = tab !== 'login';
  $('#register-form').hidden = tab !== 'register';
  setAuthMessage('');
}
function showAuth(tab = 'login') { authScreen.hidden = false; app.hidden = true; setAuthTab(tab); }
function showApp() { authScreen.hidden = true; app.hidden = false; }
function updateIdentity() {
  const name = currentProfile?.display_name || currentUser?.user_metadata?.display_name || 'Your name';
  const username = currentProfile?.username || currentUser?.user_metadata?.username || 'username';
  $('#side-name').textContent = name;
  $('#side-handle').textContent = '@' + username;
  $('#side-avatar').textContent = initials(name);
  if (currentProfile?.avatar_url) $('#side-avatar').innerHTML = `<img src="${esc(currentProfile.avatar_url)}" alt="">`;
}
function pageHead(title, desc = '', action = '') { return `<div class="page-head"><div><h2>${esc(title)}</h2>${desc ? `<p>${esc(desc)}</p>` : ''}</div>${action}</div>`; }
function section(title, body) { return `<section class="section"><h3 class="section-title">${esc(title)}</h3>${body}</section>`; }
function empty(message) { return `<p class="empty-state">${esc(message)}</p>`; }
function field(label, name, value = '', type = 'text', extra = '') { return `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`; }
async function go(view) {
  const nextView = view in titles ? view : 'home';
  if (nextView === 'messages' && currentView !== 'messages') activeChatUser = null;
  currentView = nextView;
  if (location.hash !== '#' + currentView) history.replaceState(null, '', '#' + currentView);
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === currentView));
  $('#breadcrumb').textContent = titles[currentView];
  closeMobileSidebar();
  await renderView();
}
function errorText(error) { return error?.message || 'Something went wrong. Please try again.'; }
function stopRealtime() {
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}
function scheduleRealtimeRefresh(payload) {
  if (!currentUser || !payload) return;
  const row = payload.new || payload.old || {};
  const table = payload.table;
  let relevant = false;
  if (table === 'messages') {
    const otherId = row.sender_id === currentUser.id ? row.recipient_id : row.sender_id;
    if (currentView === 'messages' && payload.eventType === 'INSERT') {
      if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = window.setTimeout(() => {
        realtimeRefreshTimer = null;
        if (!currentUser || currentView !== 'messages') return;
        if (activeChatUser === otherId) openChat(otherId);
        else renderMessages();
      }, 250);
    }
    return;
  }
  if (table === 'posts') relevant = (currentView === 'home') || (currentView === 'posts' && row.user_id === currentUser.id) || (currentView === 'public-profile' && row.user_id === viewedProfileId);
  else if (table === 'friendships' || table === 'follows') relevant = currentView === 'friends' || currentView === 'public-profile';
  else if (table === 'profiles') relevant = (currentView === 'profile' && row.id === currentUser.id) || (currentView === 'public-profile' && row.id === viewedProfileId);
  else if (table === 'media_items') relevant = (row.user_id === currentUser.id) && ['images','videos','audio'].includes(currentView);
  else if (['projects','movies','recommendations'].includes(table)) relevant = currentView === table && row.user_id === currentUser.id;
  if (!relevant) return;
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = window.setTimeout(() => { realtimeRefreshTimer = null; if (currentUser) renderView(); }, 450);
}
function postSeenKey() { return `ps-posts-seen-${currentUser?.id || 'guest'}`; }
function getPostSeenAt() {
  let value = localStorage.getItem(postSeenKey());
  if (!value) { value = new Date().toISOString(); localStorage.setItem(postSeenKey(), value); }
  return value;
}
function setPostSeenAt(value = new Date().toISOString()) { localStorage.setItem(postSeenKey(), value); }
function initNotificationUI() {
  if ($('#notification-button')) return;
  const actions = $('.topbar-actions');
  if (!actions) return;
  actions.insertAdjacentHTML('afterbegin', `<div class="notification-wrap"><button id="notification-button" class="icon-button topbar-icon notification-button" type="button" aria-label="Notifications" aria-expanded="false" data-tooltip="Notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><span id="notification-badge" class="notification-badge" hidden>0</span></button><div id="notification-panel" class="notification-panel" hidden><div class="notification-panel-head"><strong>Notifications</strong><button type="button" id="notification-close" class="text-button">Close</button></div><div id="notification-content"><p class="muted">Loading…</p></div></div></div>`);
  const style = document.createElement('style');
  style.textContent = `.notification-wrap{position:relative}.notification-badge,.nav-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:10px;background:var(--danger);color:white;font-size:11px;font-weight:700}.notification-badge{position:absolute;top:-4px;right:-5px;border:2px solid var(--paper)}.nav-count{margin-left:auto}.notification-panel{position:absolute;right:0;top:calc(100% + 10px);width:min(370px,calc(100vw - 28px));max-height:min(72vh,540px);overflow:auto;overscroll-behavior:contain;background:var(--paper);border:1px solid var(--line);z-index:40;padding:14px;box-shadow:0 5px 18px #0002}.notification-panel-head{display:flex;justify-content:space-between;align-items:center;position:sticky;top:-14px;background:var(--paper);border-bottom:1px solid var(--line);padding:8px 0 10px;margin-bottom:8px;z-index:1}.notification-group{margin:12px 0}.notification-group h4{font-size:12px;color:var(--muted);margin:0 0 5px;text-transform:uppercase;letter-spacing:.05em}.notification-item{display:block;width:100%;text-align:left;padding:10px 6px;background:none;color:var(--text);border:0;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.notification-item:hover{background:var(--soft)}.notification-item small{display:block;margin-top:4px;overflow-wrap:anywhere}.notification-empty{font-size:13px;color:var(--muted);padding:8px 0}.sidebar .nav-link{gap:9px}@media(max-width:760px){.notification-panel{position:fixed;top:68px;left:10px;right:10px;width:auto;max-height:calc(100vh - 82px);max-height:calc(100dvh - 82px);padding:12px}.notification-panel-head{top:-12px}}`;
  document.head.appendChild(style);
}
async function refreshNotificationBadges() {
  if (!currentUser || !supabase) return;
  try {
    const [messages, requests, follows] = await Promise.all([
      supabase.from('messages').select('id', { count:'exact', head:true }).eq('recipient_id', currentUser.id).is('read_at', null),
      supabase.from('friendships').select('id', { count:'exact', head:true }).eq('addressee_id', currentUser.id).eq('status', 'pending'),
      supabase.from('follows').select('followed_id').eq('follower_id', currentUser.id)
    ]);
    const unread = messages.count || 0;
    const pending = requests.count || 0;
    let newPosts = 0;
    const followedIds = [...new Set((follows.data || []).map(x => x.followed_id))];
    if (followedIds.length) {
      const postCount = await supabase.from('posts').select('id', { count:'exact', head:true }).in('user_id', followedIds).gt('created_at', getPostSeenAt());
      newPosts = postCount.count || 0;
    }
    const badge = $('#notification-badge');
    if (badge) { const total = unread + pending + newPosts; badge.textContent = total > 99 ? '99+' : String(total); badge.hidden = total === 0; }
    const setNavBadge = (view, count) => {
      const link = $(`.nav-link[data-view="${view}"]`);
      if (!link) return;
      let el = $('.nav-count', link);
      if (!el) { el = document.createElement('span'); el.className = 'nav-count'; link.appendChild(el); }
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = count === 0;
    };
    setNavBadge('messages', unread);
    setNavBadge('friends', pending);
  } catch (error) { console.warn('Could not refresh notification counts:', error); }
}
async function loadNotificationPanel() {
  const content = $('#notification-content');
  if (!content || !currentUser) return;
  content.innerHTML = '<p class="muted">Loading…</p>';
  const since = getPostSeenAt();
  const [messages, requests, follows] = await Promise.all([
    supabase.from('messages').select('id,sender_id,body,created_at').eq('recipient_id', currentUser.id).is('read_at', null).order('created_at', { ascending:false }).limit(8),
    supabase.from('friendships').select('id,requester_id,created_at').eq('addressee_id', currentUser.id).eq('status','pending').order('created_at', { ascending:false }).limit(8),
    supabase.from('follows').select('followed_id').eq('follower_id', currentUser.id)
  ]);
  if (messages.error || requests.error || follows.error) { content.innerHTML = `<p class="notification-empty">${esc(errorText(messages.error || requests.error || follows.error))}</p>`; return; }
  const followedIds = [...new Set((follows.data || []).map(x => x.followed_id))];
  let posts = { data:[], error:null };
  if (followedIds.length) posts = await supabase.from('posts').select('id,user_id,body,created_at').in('user_id', followedIds).gt('created_at', since).order('created_at', { ascending:false }).limit(8);
  if (posts.error) { content.innerHTML = `<p class="notification-empty">${esc(posts.error.message)}</p>`; return; }
  const ids = [...new Set([...(messages.data || []).map(x => x.sender_id), ...(requests.data || []).map(x => x.requester_id), ...(posts.data || []).map(x => x.user_id)])];
  let profiles = [];
  if (ids.length) { const result = await supabase.from('profiles').select('id,display_name,username').in('id', ids); if (!result.error) profiles = result.data || []; }
  const names = Object.fromEntries(profiles.map(x => [x.id, x.display_name || x.username || 'Member']));
  const group = (title, rows, renderer) => rows.length ? `<div class="notification-group"><h4>${title}</h4>${rows.map(renderer).join('')}</div>` : '';
  const messageHtml = group('Unread messages', messages.data || [], x => `<button class="notification-item" data-notification-chat="${x.sender_id}">New message from <strong>${esc(names[x.sender_id] || 'Member')}</strong><small>${esc(String(x.body || '').slice(0,90))} · ${new Date(x.created_at).toLocaleString()}</small></button>`);
  const requestHtml = group('Friend requests', requests.data || [], x => `<button class="notification-item" data-notification-friends="${x.id}"><strong>${esc(names[x.requester_id] || 'Someone')}</strong> sent you a friend request<small>${new Date(x.created_at).toLocaleString()}</small></button>`);
  const postHtml = group('New posts from people you follow', posts.data || [], x => `<button class="notification-item" data-notification-post="${x.user_id}" data-post-created="${esc(x.created_at)}"><strong>${esc(names[x.user_id] || 'Member')}</strong> published a post<small>${esc(String(x.body || '').slice(0,90))} · ${new Date(x.created_at).toLocaleString()}</small></button>`);
  content.innerHTML = messageHtml + requestHtml + postHtml || '<p class="notification-empty">You are all caught up.</p>';
  if (posts.data?.length) setPostSeenAt(posts.data[0].created_at);
  await refreshNotificationBadges();
}
async function handleRealtimeNotification(payload) {
  if (!currentUser || payload.eventType !== 'INSERT') return;
  const row = payload.new || {};
  if (payload.table === 'messages' && row.recipient_id === currentUser.id) {
    const { data } = await supabase.from('profiles').select('display_name').eq('id', row.sender_id).maybeSingle();
    toast(`New message from ${data?.display_name || 'someone'}`);
  } else if (payload.table === 'friendships' && row.addressee_id === currentUser.id && row.status === 'pending') {
    const { data } = await supabase.from('profiles').select('display_name').eq('id', row.requester_id).maybeSingle();
    toast(`New friend request from ${data?.display_name || 'someone'}`);
  } else if (payload.table === 'posts' && row.user_id !== currentUser.id) {
    const { data: follow } = await supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', row.user_id).maybeSingle();
    if (follow) {
      const { data } = await supabase.from('profiles').select('display_name').eq('id', row.user_id).maybeSingle();
      toast(`New post from ${data?.display_name || 'someone you follow'}`);
    }
  }
  if (notificationRefreshTimer) window.clearTimeout(notificationRefreshTimer);
  notificationRefreshTimer = window.setTimeout(() => { notificationRefreshTimer = null; refreshNotificationBadges(); }, 300);
}
function startRealtime(userId) {
  if (!supabase || !userId) return;
  stopRealtime();
  initNotificationUI();
  const tables = ['profiles','posts','friendships','follows','messages','media_items','projects','movies','recommendations'];
  let channel = supabase.channel(`personal-space-live-${userId}`);
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      if (payload.table === 'messages' && payload.eventType !== 'INSERT') return;
      handleRealtimeNotification(payload);
      scheduleRealtimeRefresh(payload);
    });
  }
  realtimeChannel = channel.subscribe(() => {});
  refreshNotificationBadges();
}
async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Your account exists, but its profile record was not created. Please contact support before creating another account.');
  currentProfile = data;
  updateIdentity();
}
async function renderView() {
  if (!currentUser) return showAuth();
  const token = ++renderToken;
  viewContainer.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await loadProfile();
    if (token !== renderToken) return;
    const pages = { home: renderHome, profile: renderProfile, 'public-profile': renderPublicProfile, posts: renderPosts, friends: renderFriends, messages: renderMessages, images: () => renderMedia('image'), videos: () => renderMedia('video'), audio: () => renderMedia('audio'), projects: () => renderCollection('projects'), movies: () => renderCollection('movies'), recommendations: () => renderCollection('recommendations'), settings: renderSettings };
    await (pages[currentView] || renderHome)();
  } catch (error) {
    if (token === renderToken) viewContainer.innerHTML = pageHead(titles[currentView], 'We could not load this section.') + `<p class="error-text">${esc(errorText(error))}</p><button class="button" data-action="retry">Try again</button>`;
  }
}
async function renderHome() {
  const { data: posts, error } = await supabase.from('posts').select('id,body,visibility,created_at,user_id').order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  const ids = [...new Set((posts || []).map(p => p.user_id))];
  let profiles = [];
  if (ids.length) { const result = await supabase.from('profiles').select('id,display_name,username').in('id', ids); if (!result.error) profiles = result.data || []; }
  const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
  viewContainer.innerHTML = pageHead('Welcome back', `Your space, ${currentProfile.display_name}.`, '<button class="button primary" data-action="new-post">Write a post</button>') +
    `<div class="stat-line"><span>@${esc(currentProfile.username)}</span><span>${esc(currentProfile.bio || 'Add a short bio in your profile.')}</span></div>` +
    section('Recent public posts', posts?.length ? `<ul class="plain-list">${posts.map(p => `<li><strong>${esc(byId[p.user_id]?.display_name || 'Member')}</strong> <span class="muted">@${esc(byId[p.user_id]?.username || 'member')}</span><p class="post-body">${esc(p.body)}</p><span class="post-meta">${new Date(p.created_at).toLocaleString()} · ${esc(p.visibility)}</span></li>`).join('')}</ul>` : empty('No posts to show yet.')) +
    section('Your space', '<p>Use the navigation to manage your profile, posts, connections, messages, media and personal collections.</p>');
}
async function renderProfile() {
  const p = currentProfile;
  const avatarUrl = safeHttpUrl(p.avatar_url);
  const coverUrl = safeHttpUrl(p.cover_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="Profile picture">` : esc(initials(p.display_name));
  const cover = coverUrl ? `<img class="profile-cover-preview" src="${esc(coverUrl)}" alt="Profile banner">` : '<div class="profile-cover-empty">No banner added yet</div>';
  viewContainer.innerHTML = pageHead('My profile', 'Edit your profile and choose the images people see when they visit your space.') +
    `<div class="profile-cover-wrap">${cover}</div><div class="profile-header"><div class="avatar">${avatar}</div><div><h2>${esc(p.display_name)}</h2><p class="muted">@${esc(p.username)}</p><p>${esc(p.bio || 'No biography added yet.')}</p></div></div>` +
    `<div class="profile-image-controls"><form id="avatar-upload-form" class="content-form profile-upload-form"><h3>Profile picture</h3><p class="muted">Choose a square image if possible. JPG, PNG, WEBP or GIF, up to 10 MB.</p><label>Choose profile picture<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="button" type="submit">Upload profile picture</button></form><form id="cover-upload-form" class="content-form profile-upload-form"><h3>Profile banner</h3><p class="muted">A wide image works best. JPG, PNG, WEBP or GIF, up to 10 MB.</p><label>Choose banner image<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="button" type="submit">Upload banner</button></form></div>` +
    `<form id="profile-form" class="content-form"><h3>Edit profile details</h3>${field('Display name','display_name',p.display_name,'text','maxlength="60" required')}${field('Username','username',p.username,'text','minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required')}<label>Biography<textarea name="bio" maxlength="300">${esc(p.bio || '')}</textarea></label>${field('Website link','website',p.website || '', 'url','placeholder="https://"')}<label>Profile visibility<select name="profile_visibility"><option value="public" ${p.profile_visibility === 'public' ? 'selected' : ''}>Public</option><option value="friends" ${p.profile_visibility === 'friends' ? 'selected' : ''}>Friends only</option></select></label><button class="button primary" type="submit">Save profile</button></form>`;
}
async function renderPublicProfile() {
  if (!viewedProfileId || viewedProfileId === currentUser.id) { go('profile'); return; }
  const { data: person, error } = await supabase.from('profiles').select('id,username,display_name,bio,avatar_url,cover_url,website,profile_visibility,created_at').eq('id', viewedProfileId).maybeSingle();
  if (error) throw error;
  if (!person) {
    viewContainer.innerHTML = pageHead('Profile unavailable', 'This profile may be private or no longer available.') + '<button class="button" data-view="friends">Back to people</button>';
    return;
  }
  const [{ data: posts, error: postError }, { data: friendship }, { data: following }] = await Promise.all([
    supabase.from('posts').select('id,body,visibility,created_at').eq('user_id', person.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('friendships').select('id,status,requester_id,addressee_id').or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${person.id}),and(requester_id.eq.${person.id},addressee_id.eq.${currentUser.id})`).maybeSingle(),
    supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', person.id).maybeSingle()
  ]);
  if (postError) throw postError;
  const avatarUrl = safeHttpUrl(person.avatar_url);
  const coverUrl = safeHttpUrl(person.cover_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="${esc(person.display_name)}" style="width:100%;height:100%;object-fit:cover">` : esc(initials(person.display_name));
  const cover = coverUrl ? `<img src="${esc(coverUrl)}" alt="${esc(person.display_name)} cover" style="width:100%;max-height:190px;object-fit:cover;border:1px solid var(--line);margin-bottom:16px">` : '';
  const friendshipAction = friendship ? `<span class="muted">Friendship: ${esc(friendship.status)}</span>` : `<button class="button" data-add-friend="${person.id}">Send friend request</button>`;
  const followAction = following ? '<span class="muted">You follow this person</span>' : `<button class="button" data-follow-user="${person.id}">Follow</button>`;
  const websiteUrl = safeHttpUrl(person.website);
  const website = websiteUrl ? `<p><a href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">${esc(person.website)}</a></p>` : '';
  const postRows = posts?.length ? `<ul class="plain-list">${posts.map(post => `<li><p class="post-body">${esc(post.body)}</p><span class="post-meta">${new Date(post.created_at).toLocaleString()} · ${esc(post.visibility)}</span></li>`).join('')}</ul>` : empty('No posts are available to view.');
  const joined = person.created_at ? `Member since ${new Date(person.created_at).toLocaleDateString()}` : '';
  viewContainer.innerHTML = pageHead('Member profile', `A look at what ${person.display_name} has chosen to share.`, '<button class="button" data-view="friends">Back to people</button>') + cover +
    `<div class="profile-header"><div class="avatar">${avatar}</div><div><h2>${esc(person.display_name)}</h2><p class="muted">@${esc(person.username)}</p><p>${esc(person.bio || 'No biography added.')}</p>${website}<p class="post-meta">${esc(joined)}</p><div class="inline-actions">${friendshipAction}${followAction}</div></div></div>` +
    section('Publications', postRows);
}

async function renderPosts() {
  const { data: posts, error } = await supabase.from('posts').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error) throw error;
  viewContainer.innerHTML = pageHead('My posts', 'Write and manage your publications.', '<button class="button primary" data-action="focus-post">New post</button>') +
    `<form id="post-form" class="content-form"><h3>Write something</h3><label>Post<textarea name="body" required maxlength="10000" placeholder="What’s on your mind?"></textarea></label><label>Who can see this?<select name="visibility"><option value="public">Public</option><option value="friends">Friends only</option><option value="private">Private</option></select></label><button class="button primary" type="submit">Publish post</button></form>` +
    section('Published posts', posts.length ? `<ul class="plain-list">${posts.map(p => `<li><div class="row-between"><span class="post-meta">${new Date(p.created_at).toLocaleString()} · ${esc(p.visibility)}</span><button class="text-button" data-delete-post="${p.id}">Delete</button></div><p class="post-body">${esc(p.body)}</p></li>`).join('')}</ul>` : empty('You have not published anything yet.'));
}
async function renderFriends() {
  const { data: links, error } = await supabase.from('friendships').select('*').or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`).order('created_at', { ascending: false });
  if (error) throw error;
  const { data: follows, error: followError } = await supabase.from('follows').select('*').or(`follower_id.eq.${currentUser.id},followed_id.eq.${currentUser.id}`);
  if (followError) throw followError;
  const otherIds = [...new Set([...(links || []).map(x => x.requester_id === currentUser.id ? x.addressee_id : x.requester_id), ...(follows || []).map(x => x.follower_id === currentUser.id ? x.followed_id : x.follower_id)])];
  let people = [];
  if (otherIds.length) { const r = await supabase.from('profiles').select('id,username,display_name').in('id', otherIds); if (r.error) throw r.error; people = r.data || []; }
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const linkRows = links.length ? links.map(f => { const incoming = f.addressee_id === currentUser.id; const other = incoming ? f.requester_id : f.addressee_id; return `<li><strong>${esc(byId[other]?.display_name || 'Member')}</strong> · @${esc(byId[other]?.username || 'unknown')} <button class="text-button" data-open-profile="${other}">View profile</button> <span class="muted">${incoming ? 'Incoming' : 'Outgoing'} ${esc(f.status)}</span> ${f.status === 'pending' && incoming ? `<button class="button" data-accept-friend="${f.id}">Accept</button>` : ''}</li>`; }).join('') : '';
  viewContainer.innerHTML = pageHead('Friends & followers', 'Find people and manage connection requests.') +
    `<form id="user-search" class="content-form"><h3>Find someone</h3><label>Exact username<input name="username" placeholder="username" required></label><button class="button" type="submit">Search</button><div id="search-results"></div></form>` +
    section('Friend requests and connections', linkRows ? `<ul class="plain-list">${linkRows}</ul>` : empty('No friend requests or connections yet.')) +
    section('Followers and following', follows?.length ? `<ul class="plain-list">${follows.map(f => { const outgoing = f.follower_id === currentUser.id; const other = outgoing ? f.followed_id : f.follower_id; const followsBack = follows.some(x => x.follower_id === currentUser.id && x.followed_id === other); const followBack = !outgoing && !followsBack ? `<button class="button subtle" data-follow-user="${other}">Follow back</button>` : followsBack && !outgoing ? '<span class="muted">You follow back</span>' : ''; return `<li>${outgoing ? 'You follow' : 'Follows you'} <strong>${esc(byId[other]?.display_name || 'Member')}</strong> · @${esc(byId[other]?.username || 'unknown')} <button class="text-button" data-open-profile="${other}">View profile</button> ${followBack}</li>`; }).join('')}</ul>` : empty('No followers or followed accounts yet.'));
}
async function renderMessages() {
  const keepChat = activeChatUser;
  const { data: friends, error } = await supabase.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted').or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if (error) throw error;
  const friendIds = [...new Set((friends || []).map(f => f.requester_id === currentUser.id ? f.addressee_id : f.requester_id))];
  const [recentResult, unreadResult] = await Promise.all([
    supabase.from('messages').select('id,sender_id,recipient_id,body,created_at').or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).order('created_at', { ascending: false }).limit(250),
    supabase.from('messages').select('id,sender_id').eq('recipient_id', currentUser.id).is('read_at', null).order('created_at', { ascending: false })
  ]);
  if (recentResult.error) throw recentResult.error;
  if (unreadResult.error) throw unreadResult.error;
  const latestByPerson = new Map();
  for (const m of recentResult.data || []) {
    const other = m.sender_id === currentUser.id ? m.recipient_id : m.sender_id;
    if (!latestByPerson.has(other)) latestByPerson.set(other, m);
  }
  const unreadByPerson = {};
  for (const m of unreadResult.data || []) unreadByPerson[m.sender_id] = (unreadByPerson[m.sender_id] || 0) + 1;
  const ids = [...new Set([...friendIds, ...latestByPerson.keys()])];
  chatProfiles = {};
  if (ids.length) {
    const r = await supabase.from('profiles').select('id,username,display_name').in('id', ids);
    if (r.error) throw r.error;
    chatProfiles = Object.fromEntries((r.data || []).map(p => [p.id, p]));
  }
  const people = ids.map(id => chatProfiles[id] || { id, username: 'unknown', display_name: 'Member' });
  people.sort((a, b) => {
    const ta = latestByPerson.get(a.id)?.created_at || '';
    const tb = latestByPerson.get(b.id)?.created_at || '';
    return tb.localeCompare(ta) || a.display_name.localeCompare(b.display_name);
  });
  const list = people.length ? people.map(p => {
    const last = latestByPerson.get(p.id);
    const unread = unreadByPerson[p.id] || 0;
    const preview = last ? `${last.sender_id === currentUser.id ? 'You: ' : ''}${String(last.body || '').slice(0, 54)}` : 'No messages yet';
    const when = last ? new Date(last.created_at).toLocaleString() : '';
    return `<button type="button" class="conversation-item${keepChat === p.id ? ' active' : ''}" data-chat-user="${p.id}"><span class="conversation-topline"><strong>${esc(p.display_name)}</strong>${unread ? `<span class="conversation-unread">${unread > 99 ? '99+' : unread}</span>` : ''}</span><span class="muted conversation-handle">@${esc(p.username)}</span><span class="conversation-preview">${esc(preview)}</span>${when ? `<small class="conversation-time">${esc(when)}</small>` : ''}</button>`;
  }).join('') : empty('You need an accepted friend connection before messaging.');
  viewContainer.innerHTML = pageHead('Messages', 'Recent conversations appear first. Unread messages are marked.') +
    `<div class="message-layout"><div class="conversation-list"><strong>Recent conversations</strong>${list}</div><div class="chat-panel"><div class="chat-messages" id="chat-messages">${empty('Choose a conversation to open it.')}</div><form id="message-form" class="chat-compose"><input name="body" placeholder="Write a message…" aria-label="Message" maxlength="5000" required disabled><button class="button primary" type="submit" disabled>Send</button></form></div></div>`;
  const selected = people.find(p => p.id === keepChat) || people.find(p => latestByPerson.has(p.id));
  activeChatUser = null;
  if (selected) await openChat(selected.id);
}
async function openChat(userId) {
  activeChatUser = userId;
  const box = $('#chat-messages');
  const form = $('#message-form');
  if (!box || !form) return;
  $$('.conversation-item').forEach(button => button.classList.toggle('active', button.dataset.chatUser === userId));
  form.querySelector('input').disabled = false;
  form.querySelector('button').disabled = false;
  box.innerHTML = '<p class="muted">Loading conversation…</p>';
  if (!chatProfiles[userId]) {
    const profileResult = await supabase.from('profiles').select('id,username,display_name').eq('id', userId).maybeSingle();
    if (profileResult.data) chatProfiles[userId] = profileResult.data;
  }
  const otherName = chatProfiles[userId]?.display_name || 'Member';
  const { data, error } = await supabase.from('messages').select('*').or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${currentUser.id})`).order('created_at', { ascending: true });
  if (error) { box.innerHTML = `<p class="error-text">${esc(error.message)}</p>`; return; }
  box.innerHTML = data.length ? data.map(m => `<p class="chat-line"><strong>${m.sender_id === currentUser.id ? 'You' : esc(otherName)}:</strong> ${esc(m.body)}<span class="post-meta">${new Date(m.created_at).toLocaleString()}</span></p>`).join('') : empty('No messages yet. Start the conversation.');
  box.scrollTop = box.scrollHeight;
  await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', userId).eq('recipient_id', currentUser.id).is('read_at', null);
  $(`.conversation-item[data-chat-user=\"${userId}\"] .conversation-unread`)?.remove();
  refreshNotificationBadges();
}
async function renderMedia(kind) {
  const label = { image: 'Images', video: 'Videos', audio: 'Audio' }[kind];
  const { data: items, error } = await supabase.from('media_items').select('*').eq('user_id', currentUser.id).eq('media_type', kind).order('created_at', { ascending: false });
  if (error) throw error;
  const rendered = [];
  for (const item of items) {
    let url = item.public_url;
    if (item.storage_path) { const signed = await supabase.storage.from('user-media').createSignedUrl(item.storage_path, 3600); if (!signed.error) url = signed.data.signedUrl; }
    const media = url ? (kind === 'image' ? `<img class="media-preview" src="${esc(url)}" alt="${esc(item.title)}">` : kind === 'video' ? `<video class="media-preview" controls src="${esc(url)}"></video>` : `<audio controls src="${esc(url)}"></audio>`) : '<p class="muted">File link unavailable.</p>';
    rendered.push(`<li><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p>${media}<span class="post-meta">${esc(item.visibility)} · ${new Date(item.created_at).toLocaleDateString()}</span><button class="text-button" data-delete-media="${item.id}" data-storage-path="${esc(item.storage_path || '')}">Delete</button></li>`);
  }
  viewContainer.innerHTML = pageHead(label, `Upload ${kind} to your private library. Files are private to your account in this version.`) +
    `<form id="media-form" class="content-form"><h3>Add ${kind}</h3>${field('Title','title','','text','required maxlength="120"')}<label>Select file<input name="file" type="file" accept="${kind}/*" required></label><label>Description<textarea name="description" maxlength="500"></textarea></label><button class="button primary" type="submit">Upload ${kind}</button><small>Maximum file size: 50 MB.</small></form>` +
    section('Your library', rendered.length ? `<ul class="plain-list">${rendered.join('')}</ul>` : empty(`No ${kind} uploaded yet.`));
}
const collectionConfig = {
  projects: { title: 'Projects & games', fields: ['title','description','url','github_url','status'], labels: { title:'Title',description:'Description',url:'Live link',github_url:'GitHub link',status:'Status' } },
  movies: { title: 'Movies', fields: ['title','release_year','rating','watched_on','review'], labels: { title:'Title',release_year:'Release year',rating:'Your rating (0–10)',watched_on:'Date watched',review:'Your review' } },
  recommendations: { title: 'Recommendations', fields: ['title','description','url','category','affiliate_disclosure'], labels: { title:'Title',description:'Description',url:'Link',category:'Category',affiliate_disclosure:'Affiliate disclosure' } }
};
async function renderCollection(table) {
  const cfg = collectionConfig[table];
  const { data, error } = await supabase.from(table).select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error) throw error;
  const formFields = cfg.fields.map(f => {
    const label = cfg.labels[f];
    if (['description','review','affiliate_disclosure'].includes(f)) return `<label>${esc(label)}<textarea name="${f}" maxlength="2000"></textarea></label>`;
    if (f === 'status') return `<label>${esc(label)}<select name="status"><option>planning</option><option selected>in progress</option><option>completed</option><option>archived</option></select></label>`;
    const type = f === 'url' || f === 'github_url' ? 'url' : f === 'watched_on' ? 'date' : f === 'rating' || f === 'release_year' ? 'number' : 'text';
    const extra = f === 'title' ? 'required maxlength="160"' : f === 'rating' ? 'min="0" max="10" step="0.5"' : f === 'release_year' ? 'min="1880" max="2100"' : '';
    return `<label>${esc(label)}<input name="${f}" type="${type}" ${extra}></label>`;
  }).join('');
  const rows = data.length ? `<ul class="plain-list">${data.map(item => `<li><strong>${esc(item.title)}</strong><p>${esc(item.description || item.review || '')}</p><span class="post-meta">${esc(item.status || item.category || item.watched_on || '')}${item.rating != null ? ` · Rating ${esc(item.rating)}/10` : ''}</span>${item.url ? `<p><a href="${esc(item.url)}" target="_blank" rel="noopener">Open link</a></p>` : ''}<button class="text-button" data-delete-entry="${item.id}" data-table="${table}">Delete</button></li>`).join('')}</ul>` : empty('Nothing here yet.');
  viewContainer.innerHTML = pageHead(cfg.title, 'Add and manage your personal collection.') + `<form id="collection-form" class="content-form"><h3>Add entry</h3>${formFields}<button class="button primary" type="submit">Save entry</button></form>` + section('Your entries', rows);
}
function renderSettings() {
  viewContainer.innerHTML = pageHead('Settings', 'Manage your account and appearance.') +
    section('Appearance', '<p>Choose a theme for this device.</p><button class="button" id="settings-theme">Switch light/dark theme</button>') +
    section('Account', `<p>Email: ${esc(currentUser.email || '')}</p><p>Username: @${esc(currentProfile.username)}</p><p class="muted">Use the log out button in the sidebar to end this session.</p><button class="button" id="reset-password">Send password reset email</button>`) +
    section('Privacy', '<p class="muted">Your posts use Public, Friends only or Private visibility. Media files in this version are private to their owner. Do not upload sensitive documents.</p>');
}

async function handleAuth(event, kind) {
  event.preventDefault();
  const formEl = event.target;
  const fd = new FormData(formEl);
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  setBusy(formEl, true, kind === 'login' ? 'Logging in…' : 'Creating account…');
  setAuthMessage('');
  try {
    let result;
    if (kind === 'login') {
      result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      currentUser = result.data.user;
      await loadProfile();
      showApp();
      go('home');
    } else {
      const displayName = String(fd.get('display_name') || '').trim();
      const username = String(fd.get('username') || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3–24 characters using letters, numbers and underscores.');
      result = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, username }, emailRedirectTo: window.location.origin } });
      if (result.error) throw result.error;
      if (result.data.session) {
        currentUser = result.data.user;
        await loadProfile();
        showApp();
        go('home');
      } else {
        setAuthMessage('Account created. Check your email and confirm the address. Then return to this page and log in with the same email and password. If the confirmation link sends you somewhere unexpected, the Supabase redirect URL needs configuring.');
      }
    }
  } catch (error) {
    setAuthMessage(errorText(error), true);
  } finally { setBusy(formEl, false); }
}
async function submitProfile(form) {
  const fd = new FormData(form);
  const username = String(fd.get('username')).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return toast('Username must be 3–24 letters, numbers or underscores.');
  const { error } = await supabase.from('profiles').update({ display_name: String(fd.get('display_name')).trim(), username, bio: fd.get('bio') || '', website: fd.get('website') || null, profile_visibility: fd.get('profile_visibility') }).eq('id', currentUser.id);
  if (error) return toast(error.message);
  await loadProfile(); toast('Profile saved.'); renderProfile();
}
async function submitProfileImage(form, fieldName) {
  const file = new FormData(form).get('file');
  if (!file || !file.size) return toast('Choose an image first.');
  if (!file.type.startsWith('image/')) return toast('Please choose an image file.');
  if (file.size > 10 * 1024 * 1024) return toast('Images must be 10 MB or smaller.');
  const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
  if (!allowed.includes(file.type)) return toast('Use JPG, PNG, WEBP or GIF.');
  const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[file.type];
  const path = `${currentUser.id}/${fieldName}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  setBusy(form, true, 'Uploading…');
  try {
    const upload = await supabase.storage.from('profile-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
    if (upload.error) throw upload.error;
    const { data } = supabase.storage.from('profile-media').getPublicUrl(path);
    const { error } = await supabase.from('profiles').update({ [fieldName]: data.publicUrl }).eq('id', currentUser.id);
    if (error) { await supabase.storage.from('profile-media').remove([path]); throw error; }
    await loadProfile();
    toast(fieldName === 'avatar_url' ? 'Profile picture updated.' : 'Profile banner updated.');
    renderProfile();
  } finally { setBusy(form, false); }
}
async function submitPost(form) {
  const fd = new FormData(form);
  const { error } = await supabase.from('posts').insert({ user_id: currentUser.id, body: String(fd.get('body')).trim(), visibility: fd.get('visibility') });
  if (error) return toast(error.message);
  toast('Post published.'); renderPosts();
}
async function searchUser(form) {
  const username = String(new FormData(form).get('username')).trim().replace(/^@/, '').toLowerCase();
  const box = $('#search-results');
  const { data, error } = await supabase.from('profiles').select('id,username,display_name').eq('username', username).maybeSingle();
  if (error || !data) { box.innerHTML = `<p class="muted">${esc(error?.message || 'No public profile found with that username.')}</p>`; return; }
  if (data.id === currentUser.id) { box.innerHTML = '<p class="muted">That is your own profile.</p>'; return; }
  const { data: existing } = await supabase.from('friendships').select('id,status,requester_id,addressee_id').or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${data.id}),and(requester_id.eq.${data.id},addressee_id.eq.${currentUser.id})`).maybeSingle();
  const action = existing ? `<span class="muted">Friendship: ${esc(existing.status)}</span>` : `<button class="button" data-add-friend="${data.id}">Send friend request</button>`;
  const { data: following } = await supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', data.id).maybeSingle();
  box.innerHTML = `<p><strong>${esc(data.display_name)}</strong> · @${esc(data.username)} <button class="text-button" data-open-profile="${data.id}">View profile</button> ${action} ${following ? '<span class="muted">You follow this person</span>' : `<button class="button" data-follow-user="${data.id}">Follow</button>`}</p>`;
}
async function sendFriendRequest(id) {
  const { error } = await supabase.from('friendships').insert({ requester_id: currentUser.id, addressee_id: id, status: 'pending' });
  toast(error ? error.message : 'Friend request sent.');
  if (!error) renderView();
}
async function acceptFriend(id) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id).eq('addressee_id', currentUser.id);
  toast(error ? error.message : 'Friend request accepted.');
  if (!error) renderView();
}
async function submitCollection(form) {
  const table = currentView;
  const fd = new FormData(form);
  const payload = { user_id: currentUser.id };
  for (const [key, value] of fd.entries()) payload[key] = value === '' ? null : value;
  for (const key of ['rating','release_year']) if (payload[key] != null) payload[key] = Number(payload[key]);
  const { error } = await supabase.from(table).insert(payload);
  if (error) return toast(error.message);
  toast('Entry saved.'); renderCollection(table);
}
async function submitMedia(form) {
  const fd = new FormData(form);
  const file = fd.get('file');
  if (!file || !file.size) return toast('Choose a file first.');
  if (file.size > 50 * 1024 * 1024) return toast('That file is larger than 50 MB.');
  const kind = currentView === 'images' ? 'image' : currentView === 'videos' ? 'video' : 'audio';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from('user-media').upload(path, file, { upsert: false });
  if (upload.error) return toast(upload.error.message);
  const { error } = await supabase.from('media_items').insert({ user_id: currentUser.id, media_type: kind, title: fd.get('title'), description: fd.get('description') || '', visibility: 'private', storage_path: path, public_url: null });
  if (error) { await supabase.storage.from('user-media').remove([path]); return toast(error.message); }
  toast('File uploaded to your private library.'); renderMedia(kind);
}
async function submitMessage(form) {
  if (!activeChatUser) return toast('Choose a friend first.');
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body) return;
  const { error } = await supabase.from('messages').insert({ sender_id: currentUser.id, recipient_id: activeChatUser, body });
  if (error) return toast(error.message);
  form.reset(); openChat(activeChatUser);
}

function updateThemeButton() {
  const button = $('#theme-toggle');
  if (!button) return;
  const dark = document.body.classList.contains('dark');
  const label = dark ? 'Light theme' : 'Dark theme';
  button.dataset.tooltip = label;
  button.title = label;
  button.setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
  button.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"></path></svg>';
}
function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('ps-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  updateThemeButton();
}
function openMobileSidebar() {
  $('#sidebar').classList.add('mobile-open');
  $('#sidebar-backdrop').hidden = false;
  $('#mobile-menu').setAttribute('aria-expanded', 'true');
}
function closeMobileSidebar() {
  $('#sidebar').classList.remove('mobile-open');
  $('#sidebar-backdrop').hidden = true;
  $('#mobile-menu').setAttribute('aria-expanded', 'false');
}
function toggleMobileSidebar() {
  if ($('#sidebar').classList.contains('mobile-open')) closeMobileSidebar();
  else openMobileSidebar();
}

// Global click handling for the sidebar and dynamically rendered controls.
document.addEventListener('click', async event => {
  if (event.target.closest('#notification-button')) {
    notificationPanelOpen = !notificationPanelOpen;
    const panel = $('#notification-panel');
    panel.hidden = !notificationPanelOpen;
    $('#notification-button').setAttribute('aria-expanded', String(notificationPanelOpen));
    if (notificationPanelOpen) await loadNotificationPanel();
    return;
  }
  if (event.target.closest('#notification-close')) { notificationPanelOpen = false; $('#notification-panel').hidden = true; $('#notification-button').setAttribute('aria-expanded','false'); return; }
  const notificationChat = event.target.closest('[data-notification-chat]');
  if (notificationChat) { $('#notification-panel').hidden = true; notificationPanelOpen = false; await go('messages'); await openChat(notificationChat.dataset.notificationChat); return; }
  if (event.target.closest('[data-notification-friends]')) { $('#notification-panel').hidden = true; notificationPanelOpen = false; go('friends'); return; }
  const notificationPost = event.target.closest('[data-notification-post]');
  if (notificationPost) { setPostSeenAt(notificationPost.dataset.postCreated || new Date().toISOString()); $('#notification-panel').hidden = true; notificationPanelOpen = false; viewedProfileId = notificationPost.dataset.notificationPost; go('public-profile'); return; }
  if (notificationPanelOpen && !event.target.closest('.notification-wrap')) { notificationPanelOpen = false; $('#notification-panel').hidden = true; $('#notification-button')?.setAttribute('aria-expanded','false'); }
  const nav = event.target.closest('[data-view]');
  if (nav) { event.preventDefault(); go(nav.dataset.view); return; }
  const tab = event.target.closest('[data-auth-tab]'); if (tab) { setAuthTab(tab.dataset.authTab); return; }
  if (event.target.closest('#collapse-sidebar')) { $('#sidebar').classList.toggle('collapsed'); return; }
  if (event.target.closest('#mobile-menu')) { toggleMobileSidebar(); return; }
  if (event.target.closest('#close-mobile-sidebar') || event.target.closest('#sidebar-backdrop')) { closeMobileSidebar(); return; }
  if (event.target.closest('#theme-toggle') || event.target.closest('#settings-theme')) { toggleTheme(); return; }
  if (event.target.closest('#logout-button')) { stopRealtime(); await supabase.auth.signOut(); currentUser = null; currentProfile = null; showAuth(); return; }
  if (event.target.closest('[data-action="retry"]')) { renderView(); return; }
  if (event.target.closest('[data-action="focus-post"]') || event.target.closest('[data-action="new-post"]')) { if (currentView !== 'posts') go('posts'); else $('#post-form textarea')?.focus(); return; }
  const delPost = event.target.closest('[data-delete-post]'); if (delPost) { if (!confirm('Delete this post?')) return; const { error } = await supabase.from('posts').delete().eq('id', delPost.dataset.deletePost).eq('user_id', currentUser.id); toast(error ? error.message : 'Post deleted.'); if (!error) renderPosts(); return; }
  const openProfile = event.target.closest('[data-open-profile]'); if (openProfile) { viewedProfileId = openProfile.dataset.openProfile; go('public-profile'); return; }
  const add = event.target.closest('[data-add-friend]'); if (add) { await sendFriendRequest(add.dataset.addFriend); return; }
  const accept = event.target.closest('[data-accept-friend]'); if (accept) { await acceptFriend(accept.dataset.acceptFriend); return; }
  const follow = event.target.closest('[data-follow-user]'); if (follow) { const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, followed_id: follow.dataset.followUser }); toast(error ? error.message : 'You are now following this person.'); if (!error) renderView(); return; }
  const chat = event.target.closest('[data-chat-user]'); if (chat) { await openChat(chat.dataset.chatUser); return; }
  const delMedia = event.target.closest('[data-delete-media]'); if (delMedia) { if (!confirm('Delete this media item?')) return; const path = delMedia.dataset.storagePath; if (path) { const r = await supabase.storage.from('user-media').remove([path]); if (r.error) return toast(r.error.message); } const r = await supabase.from('media_items').delete().eq('id', delMedia.dataset.deleteMedia).eq('user_id', currentUser.id); toast(r.error ? r.error.message : 'Media deleted.'); if (!r.error) renderView(); return; }
  const delEntry = event.target.closest('[data-delete-entry]'); if (delEntry) { if (!confirm('Delete this entry?')) return; const { error } = await supabase.from(delEntry.dataset.table).delete().eq('id', delEntry.dataset.deleteEntry).eq('user_id', currentUser.id); toast(error ? error.message : 'Entry deleted.'); if (!error) renderCollection(delEntry.dataset.table); return; }
  if (event.target.closest('#reset-password')) { const { error } = await supabase.auth.resetPasswordForEmail(currentUser.email, { redirectTo: window.location.origin }); toast(error ? error.message : 'Password reset email requested.'); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'login-form') return handleAuth(event, 'login');
  if (form.id === 'register-form') return handleAuth(event, 'register');
  event.preventDefault();
  try {
    if (form.id === 'profile-form') await submitProfile(form);
    else if (form.id === 'avatar-upload-form') await submitProfileImage(form, 'avatar_url');
    else if (form.id === 'cover-upload-form') await submitProfileImage(form, 'cover_url');
    else if (form.id === 'post-form') await submitPost(form);
    else if (form.id === 'user-search') await searchUser(form);
    else if (form.id === 'collection-form') await submitCollection(form);
    else if (form.id === 'media-form') await submitMedia(form);
    else if (form.id === 'message-form') await submitMessage(form);
  } catch (error) { toast(errorText(error)); }
});
$('#forgot-password').addEventListener('click', async () => {
  const email = $('#login-form [name="email"]').value.trim();
  if (!email) return setAuthMessage('Enter your email address first.', true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  setAuthMessage(error ? error.message : 'Password reset email requested. Check your inbox.');
});

if (localStorage.getItem('ps-theme') === 'dark') document.body.classList.add('dark');
updateThemeButton();
if (!isConfigured) {
  showAuth();
  setAuthMessage('Supabase configuration is missing. Check js/config.js.', true);
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (!currentUser) { stopRealtime(); currentProfile = null; showAuth(); return; }
    startRealtime(currentUser.id);
    showApp();
    // Avoid awaiting Supabase calls inside its auth callback.
    Promise.resolve().then(() => { if (currentUser?.id === session.user.id) go(location.hash.slice(1) || 'home'); });
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) setAuthMessage(error.message, true);
  currentUser = data.session?.user || null;
  if (currentUser) { startRealtime(currentUser.id); showApp(); await renderView(); refreshNotificationBadges(); }
  else showAuth();
}
