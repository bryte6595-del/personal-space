import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';
import { pageRoutes, viewFromLocation } from './modules/routes.js';

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
let currentView = viewFromLocation(titles);
let activeChatUser = new URLSearchParams(location.search).get('chat');
let chatProfiles = {};
let viewedProfileId = new URLSearchParams(location.search).get('member');
let renderToken = 0;
let realtimeChannel = null;
let presenceChannel = null;
let onlineUserIds = new Set();
let realtimeRefreshTimer = null;
let notificationPanelOpen = false;
let notificationRefreshTimer = null;
let activeCropper = null;
let messagePreviewUrl = null;

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
function profileLink(person, label = '') {
  const name = person?.display_name || 'Member';
  const username = person?.username || 'unknown';
  const avatarUrl = safeHttpUrl(person?.avatar_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="">` : esc(initials(name));
  return `<button type="button" class="profile-link" data-open-profile="${esc(person?.id || '')}" aria-label="View ${esc(name)} profile"><span class="avatar mini">${avatar}</span><span class="profile-link-text"><strong>${esc(name)}</strong><small>@${esc(username)}${label ? ` · ${esc(label)}` : ''}</small></span></button>`;
}
function field(label, name, value = '', type = 'text', extra = '') { return `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`; }
async function go(view, options = {}) {
  const nextView = view in titles ? view : 'home';
  const route = pageRoutes[nextView] || 'index.html';
  const params = new URLSearchParams();
  if (nextView === 'public-profile' && viewedProfileId) params.set('member', viewedProfileId);
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
  if (nextView === 'messages' && currentView !== 'messages' && !options.chat) activeChatUser = null;
  currentView = nextView;
  if (nextView === 'messages' && options.chat) activeChatUser = options.chat;
  if (nextView === 'public-profile') viewedProfileId = params.get('member');
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
  if (presenceChannel) supabase.removeChannel(presenceChannel);
  presenceChannel = null;
  onlineUserIds = new Set();
}
function updatePresenceDots() {
  $$('[data-presence-user]').forEach(dot => {
    const online = onlineUserIds.has(dot.dataset.presenceUser);
    dot.classList.toggle('is-online', online);
    dot.setAttribute('aria-label', online ? 'Online' : 'Offline');
    dot.title = online ? 'Online' : 'Offline';
    if (dot.classList.contains('presence-dot') && dot.parentElement?.classList.contains('chat-peer-presence')) dot.parentElement.lastChild.textContent = online ? 'Online' : 'Offline';
  });
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
  if (table === 'posts') {
    if (currentView === 'home' && payload.eventType === 'INSERT' && row.user_id !== currentUser.id) { showNewPostsIndicator(); return; }
    relevant = (currentView === 'home' && payload.eventType !== 'INSERT') || (currentView === 'posts' && row.user_id === currentUser.id) || (currentView === 'public-profile' && row.user_id === viewedProfileId);
  }
  else if (table === 'post_likes' || table === 'post_comment_likes') return;
  else if (['post_media','post_comments'].includes(table)) relevant = ['home','posts','public-profile'].includes(currentView);
  else if (table === 'friendships' || table === 'follows') relevant = currentView === 'friends' || currentView === 'public-profile';
  else if (table === 'profiles') relevant = (currentView === 'profile' && row.id === currentUser.id) || (currentView === 'public-profile' && row.id === viewedProfileId);
  else if (table === 'media_items') relevant = (row.user_id === currentUser.id) && ['images','videos','audio'].includes(currentView);
  else if (['projects','movies','recommendations'].includes(table)) relevant = currentView === table && row.user_id === currentUser.id;
  if (!relevant) return;
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = window.setTimeout(() => { realtimeRefreshTimer = null; if (currentUser) renderView(); }, 450);
}
function showNewPostsIndicator() {
  if (currentView !== 'home' || !$('.section') || $('#new-posts-indicator')) return;
  const feed = $('.post-feed') || $('.section');
  feed.insertAdjacentHTML('beforebegin', '<div class="new-posts-banner-wrap"><button type="button" id="new-posts-indicator" class="button primary new-posts-indicator" data-load-new-posts>↑ New posts · View latest</button></div>');
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
    supabase.from('messages').select('id,sender_id,body,media_path,created_at').eq('recipient_id', currentUser.id).is('read_at', null).order('created_at', { ascending:false }).limit(8),
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
  if (ids.length) { const result = await supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids); if (!result.error) profiles = result.data || []; }
  const names = Object.fromEntries(profiles.map(x => [x.id, x.display_name || x.username || 'Member']));
  const group = (title, rows, renderer) => rows.length ? `<div class="notification-group"><h4>${title}</h4>${rows.map(renderer).join('')}</div>` : '';
  const messageHtml = group('Unread messages', messages.data || [], x => `<button class="notification-item" data-notification-chat="${x.sender_id}">New message from <strong>${esc(names[x.sender_id] || 'Member')}</strong><small>${esc(String(x.body || (x.media_path ? '📷 Image attachment' : '')).slice(0,90))} · ${new Date(x.created_at).toLocaleString()}</small></button>`);
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
  const tables = ['profiles','posts','post_media','post_likes','post_comments','post_comment_likes','friendships','follows','messages','media_items','projects','movies','recommendations'];
  let channel = supabase.channel(`personal-space-live-${userId}`);
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      if (payload.table === 'messages' && payload.eventType !== 'INSERT') return;
      handleRealtimeNotification(payload);
      scheduleRealtimeRefresh(payload);
    });
  }
  realtimeChannel = channel.subscribe(() => {});
  presenceChannel = supabase.channel('personal-space-presence', { config: { presence: { key: userId } } });
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      const ids = new Set();
      for (const [key, metas] of Object.entries(state)) {
        if ((metas || []).some(meta => meta.user_id === key || meta.user_id)) ids.add(key);
      }
      onlineUserIds = ids;
      updatePresenceDots();
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') await presenceChannel.track({ user_id: userId, online_at: new Date().toISOString() });
    });
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
  document.title = `${titles[currentView] || 'Home'} | Personal Space`;
  if (!currentUser) return showAuth();
  const token = ++renderToken;
  viewContainer.classList.remove('messages-view', 'has-active-chat');
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
async function buildPostCards(posts, { allowDelete = false } = {}) {
  if (!posts?.length) return empty('No posts to show yet.');
  const postIds = posts.map(p => p.id);
  const userIds = [...new Set(posts.map(p => p.user_id))];
  const [mediaResult, likesResult, commentsResult, profilesResult] = await Promise.all([
    supabase.from('post_media').select('id,post_id,user_id,storage_path,position').in('post_id', postIds).order('position', { ascending: true }),
    supabase.from('post_likes').select('post_id,user_id').in('post_id', postIds),
    supabase.from('post_comments').select('id,post_id,user_id,parent_comment_id,body,created_at').in('post_id', postIds).order('created_at', { ascending: true }),
    supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', userIds)
  ]);
  for (const result of [mediaResult, likesResult, commentsResult, profilesResult]) if (result.error) throw result.error;
  const commentIds = (commentsResult.data || []).map(comment => comment.id);
  let commentLikesResult = { data: [], error: null };
  if (commentIds.length) commentLikesResult = await supabase.from('post_comment_likes').select('comment_id,user_id').in('comment_id', commentIds);
  if (commentLikesResult.error) throw commentLikesResult.error;
  const mediaByPost = {};
  await Promise.all((mediaResult.data || []).map(async item => {
    const signed = await supabase.storage.from('user-media').createSignedUrl(item.storage_path, 3600);
    if (signed.error) throw signed.error;
    (mediaByPost[item.post_id] ||= []).push({ ...item, url: signed.data.signedUrl });
  }));
  const extraIds = [...new Set([...(commentsResult.data || []).map(comment => comment.user_id), ...(likesResult.data || []).map(like => like.user_id)])].filter(id => !userIds.includes(id));
  let extraProfiles = [];
  if (extraIds.length) { const extra = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', extraIds); if (extra.error) throw extra.error; extraProfiles = extra.data || []; }
  const profileById = Object.fromEntries([...(profilesResult.data || []), ...extraProfiles].map(person => [person.id, person]));
  const likesByPost = {};
  for (const like of likesResult.data || []) {
    const item = (likesByPost[like.post_id] ||= { count: 0, mine: false });
    item.count++;
    if (like.user_id === currentUser.id) item.mine = true;
  }
  const likersByPost = {};
  for (const like of likesResult.data || []) (likersByPost[like.post_id] ||= []).push(profileById[like.user_id] || { id: like.user_id, display_name: 'Member', username: 'unknown' });
  const commentsByPost = {};
  for (const comment of commentsResult.data || []) (commentsByPost[comment.post_id] ||= []).push(comment);
  const commentLikesById = {};
  for (const like of commentLikesResult.data || []) { const item = (commentLikesById[like.comment_id] ||= { count: 0, mine: false }); item.count++; if (like.user_id === currentUser.id) item.mine = true; }
  const commentMarkup = (comment, all, depth = 0) => {
    const person = profileById[comment.user_id] || { id: comment.user_id, display_name: 'Member', username: 'unknown' };
    const replies = all.filter(x => x.parent_comment_id === comment.id);
    const commentLike = commentLikesById[comment.id] || { count: 0, mine: false };
    return `<div class="post-comment${depth ? ' post-reply' : ''}"><div class="comment-head">${profileLink(person)}<span class="post-meta">${new Date(comment.created_at).toLocaleString()}</span></div><p class="comment-body">${esc(comment.body)}</p><div class="comment-actions"><button class="text-button comment-like-button${commentLike.mine ? ' liked' : ''}" type="button" data-toggle-comment-like="${comment.id}" aria-pressed="${commentLike.mine}">${commentLike.mine ? '♥ Liked' : '♡ Like'} <span data-comment-like-count="${comment.id}">${commentLike.count || ''}</span></button>${depth === 0 ? `<button class="text-button" type="button" data-reply-comment="${comment.id}" data-post-id="${comment.post_id}">Reply</button>` : ''}${comment.user_id === currentUser.id ? `<button class="text-button" type="button" data-edit-comment="${comment.id}">Edit</button><button class="text-button" type="button" data-delete-comment="${comment.id}" data-post-id="${comment.post_id}">Delete</button>` : ''}</div>${comment.user_id === currentUser.id ? `<form class="edit-comment-form" data-edit-comment-form="${comment.id}" hidden><input name="body" maxlength="2000" value="${esc(comment.body)}" required><button class="button" type="submit">Save</button></form>` : ''}<form class="reply-form" data-reply-form="${comment.id}" data-post-id="${comment.post_id}" hidden><input name="body" maxlength="2000" placeholder="Write a reply…" required><button class="button" type="submit">Reply</button></form>${depth === 0 && replies.length ? `<div class="comment-replies">${replies.map(reply => commentMarkup(reply, all, 1)).join('')}</div>` : ''}</div>`;
  };
  return `<div class="post-feed">${posts.map(post => {
    const author = profileById[post.user_id] || { id: post.user_id, display_name: 'Member', username: 'unknown' };
    const media = mediaByPost[post.id] || [];
    const gallery = media.length ? `<div class="post-gallery ${media.length === 1 ? 'single-image' : 'multi-image'}">${media.map((item, index) => `<button type="button" class="post-image-open" data-post-image="${esc(item.url)}" data-post-id="${post.id}" data-image-index="${index}" aria-label="Open image ${index + 1} of ${media.length}"><img src="${esc(item.url)}" alt="Post image ${index + 1}" loading="lazy"></button>`).join('')}</div>` : '';
    const like = likesByPost[post.id] || { count: 0, mine: false };
    const comments = commentsByPost[post.id] || [];
    const roots = comments.filter(c => !c.parent_comment_id);
    return `<article class="post-card" data-post-card="${post.id}"><div class="post-card-head">${profileLink(author)}<div class="post-head-meta"><span class="post-meta">${new Date(post.created_at).toLocaleString()}</span><span class="post-visibility">${esc(post.visibility)}</span></div>${allowDelete && post.user_id === currentUser.id ? `<button type="button" class="text-button" data-delete-post="${post.id}">Delete</button>` : ''}</div>${post.body ? `<p class="post-body">${esc(post.body)}</p>` : ''}${gallery}<div class="post-engagement"><button type="button" class="text-button like-button${like.mine ? ' liked' : ''}" data-toggle-like="${post.id}" aria-pressed="${like.mine}">${like.mine ? '♥ Liked' : '♡ Like'}</button><button type="button" class="text-button likes-count" data-show-likes="${post.id}" data-like-count="${like.count}" ${like.count ? '' : 'disabled'}>${like.count} ${like.count === 1 ? 'like' : 'likes'}</button><span class="post-meta">${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}</span></div><div class="post-likers" data-likers="${post.id}" hidden>${(likersByPost[post.id] || []).map(person => profileLink(person)).join('')}</div><div class="post-comments">${roots.map(c => commentMarkup(c, comments)).join('')}<form class="comment-form" data-comment-form="${post.id}"><input name="body" maxlength="2000" placeholder="Write a comment…" required><button class="button" type="submit">Comment</button></form></div></article>`;
  }).join('')}</div>`;
}
function openPostImage(button) {
  const gallery = button.closest('.post-gallery');
  const images = [...(gallery?.querySelectorAll('[data-post-image]') || [])].map(el => el.dataset.postImage);
  if (images.length) openImageViewer(images, Number(button.dataset.imageIndex) || 0);
}
function openImageViewer(images, initialIndex = 0) {
  if (!images?.length) return;
  let index = Math.max(0, Math.min(initialIndex, images.length - 1));
  const modal = document.createElement('div');
  modal.className = 'image-viewer-backdrop';
  modal.innerHTML = `<div class="image-viewer" role="dialog" aria-modal="true" aria-label="Image viewer"><button type="button" class="image-viewer-close" aria-label="Close image">×</button><button type="button" class="image-viewer-prev" aria-label="Previous image" ${images.length < 2 ? 'hidden' : ''}>‹</button><img class="image-viewer-image" alt="Enlarged post image"><button type="button" class="image-viewer-next" aria-label="Next image" ${images.length < 2 ? 'hidden' : ''}>›</button><span class="image-viewer-count"></span></div>`;
  const img = modal.querySelector('img');
  const count = modal.querySelector('.image-viewer-count');
  const show = () => { img.src = images[index]; count.textContent = `${index + 1} / ${images.length}`; };
  const close = () => { modal.remove(); document.removeEventListener('keydown', keyHandler); };
  const prev = () => { index = (index - 1 + images.length) % images.length; show(); };
  const next = () => { index = (index + 1) % images.length; show(); };
  const keyHandler = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft' && images.length > 1) prev(); if (e.key === 'ArrowRight' && images.length > 1) next(); };
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.image-viewer-close')) close(); });
  modal.querySelector('.image-viewer-prev').addEventListener('click', prev);
  modal.querySelector('.image-viewer-next').addEventListener('click', next);
  document.addEventListener('keydown', keyHandler);
  document.body.append(modal); show();
}
async function togglePostLike(postId) {
  const button = $(`[data-toggle-like="${postId}"]`);
  if (!button || button.disabled) return;
  button.disabled = true;
  const existing = await supabase.from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', currentUser.id).maybeSingle();
  if (existing.error) { button.disabled = false; return toast(existing.error.message); }
  const result = existing.data
    ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
    : await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
  if (result.error) { button.disabled = false; return toast(result.error.message); }
  const liked = !existing.data;
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
  button.textContent = liked ? '♥ Liked' : '♡ Like';
  button.disabled = false;
  const countButton = $(`[data-show-likes="${postId}"]`);
  if (countButton) {
    const count = Math.max(0, Number(countButton.dataset.likeCount || 0) + (liked ? 1 : -1));
    countButton.dataset.likeCount = String(count);
    countButton.textContent = `${count} ${count === 1 ? 'like' : 'likes'}`;
    countButton.disabled = count === 0;
  }
}
async function toggleCommentLike(commentId) {
  const button = $(`[data-toggle-comment-like="${commentId}"]`);
  if (!button || button.disabled) return;
  button.disabled = true;
  const existing = await supabase.from('post_comment_likes').select('comment_id').eq('comment_id', commentId).eq('user_id', currentUser.id).maybeSingle();
  if (existing.error) { button.disabled = false; return toast(existing.error.message); }
  const result = existing.data
    ? await supabase.from('post_comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id)
    : await supabase.from('post_comment_likes').insert({ comment_id: commentId, user_id: currentUser.id });
  if (result.error) { button.disabled = false; return toast(result.error.message); }
  const liked = !existing.data;
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
  const count = $(`[data-comment-like-count="${commentId}"]`);
  const next = Math.max(0, Number(count?.textContent || 0) + (liked ? 1 : -1));
  if (count) count.textContent = next ? String(next) : '';
  button.firstChild.textContent = liked ? '♥ Liked ' : '♡ Like ';
  button.disabled = false;
}

async function submitPostComment(form) {
  const postId = form.dataset.commentForm || form.dataset.postId;
  const parentId = form.dataset.parentComment || form.dataset.replyForm || null;
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body) return;
  const { error } = await supabase.from('post_comments').insert({ post_id: postId, user_id: currentUser.id, parent_comment_id: parentId, body });
  if (error) return toast(error.message);
  toast(parentId ? 'Reply added.' : 'Comment added.');
  renderView();
}
async function submitEditComment(form) {
  const id = form.dataset.editCommentForm;
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body) return;
  const { error } = await supabase.from('post_comments').update({ body, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', currentUser.id);
  if (error) return toast(error.message);
  toast('Comment updated.'); renderView();
}

async function renderHome() {
  const { data: posts, error } = await supabase.from('posts').select('id,user_id,body,visibility,created_at').order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  const cards = await buildPostCards(posts || []);
  const shortcuts = [
    ['profile','My profile','Edit your details and profile images','◉'],
    ['friends','Friends','Manage connections and requests','♧'],
    ['messages','Messages','Continue private conversations','✉'],
    ['images','Media library','Browse your uploaded images','▧'],
    ['projects','Projects','Showcase things you are building','⌘'],
    ['movies','Movies','Keep track of what you watch','▣']
  ].map(([view,label,desc,icon]) => `<button type="button" class="home-shortcut" data-view="${view}"><span class="home-shortcut-icon">${icon}</span><span><strong>${label}</strong><small>${desc}</small></span><span class="home-shortcut-arrow">›</span></button>`).join('');
  viewContainer.innerHTML = pageHead('Home', `Welcome back, ${currentProfile.display_name}.`, '<button class="button primary" data-action="new-post">Write a post</button>') +
    `<div class="home-intro"><div><strong>@${esc(currentProfile.username)}</strong><p>${esc(currentProfile.bio || 'Your personal corner of the internet.')}</p></div><button type="button" class="button subtle" data-view="profile">View profile</button></div>` +
    section('Quick access', `<div class="home-shortcuts">${shortcuts}</div>`) +
    section('Activity feed', `<p class="muted home-feed-note">Recent posts shared with you appear here.</p>${cards}`);
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
    supabase.from('posts').select('id,user_id,body,visibility,created_at').eq('user_id', person.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('friendships').select('id,status,requester_id,addressee_id').or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${person.id}),and(requester_id.eq.${person.id},addressee_id.eq.${currentUser.id})`).maybeSingle(),
    supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', person.id).maybeSingle()
  ]);
  if (postError) throw postError;
  const avatarUrl = safeHttpUrl(person.avatar_url);
  const coverUrl = safeHttpUrl(person.cover_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="${esc(person.display_name)}" style="width:100%;height:100%;object-fit:cover">` : esc(initials(person.display_name));
  const cover = coverUrl ? `<img src="${esc(coverUrl)}" alt="${esc(person.display_name)} cover" style="width:100%;max-height:190px;object-fit:cover;border:1px solid var(--line);margin-bottom:16px">` : '';
  const friendshipAction = friendship?.status === 'accepted' ? '<span class="relationship-label">Friends</span><button class="button" data-message-user="' + person.id + '">Message</button>' : friendship?.status === 'pending' ? `<span class="muted">${friendship.requester_id === currentUser.id ? 'Friend request sent' : 'They sent you a friend request'}</span>` : friendship ? `<span class="muted">${esc(friendship.status)}</span>` : `<button class="button" data-add-friend="${person.id}">Add friend</button>`;
  const followAction = following ? `<button class="button" data-toggle-follow="${person.id}">Unfollow</button>` : `<button class="button" data-toggle-follow="${person.id}">Follow</button>`;
  const websiteUrl = safeHttpUrl(person.website);
  const website = websiteUrl ? `<p><a href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">${esc(person.website)}</a></p>` : '';
  const postRows = await buildPostCards(posts || []);
  const joined = person.created_at ? `Member since ${new Date(person.created_at).toLocaleDateString()}` : '';
  viewContainer.innerHTML = pageHead('Member profile', `A look at what ${person.display_name} has chosen to share.`, '<button class="button" data-view="friends">Back to people</button>') + cover +
    `<div class="profile-header"><div class="avatar">${avatar}</div><div><h2>${esc(person.display_name)}</h2><p class="muted">@${esc(person.username)}</p><p>${esc(person.bio || 'No biography added.')}</p>${website}<p class="post-meta">${esc(joined)}</p><div class="inline-actions">${friendshipAction}${followAction}</div></div></div>` +
    section('Publications', postRows);
}

async function renderPosts() {
  const { data: posts, error } = await supabase.from('posts').select('id,user_id,body,visibility,created_at').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error) throw error;
  const cards = await buildPostCards(posts || [], { allowDelete: true });
  viewContainer.innerHTML = pageHead('My posts', 'Share words, photographs or both.', '<button class="button primary" data-action="focus-post">New post</button>') +
    `<form id="post-form" class="content-form"><h3>Write something</h3><label>Post<textarea name="body" maxlength="10000" placeholder="What’s on your mind?"></textarea></label><label>Add images<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><small class="muted">Choose up to 5 images. Each image can be up to 10 MB. You can publish an image without text.</small><div id="post-image-preview" class="post-image-preview"></div><label>Who can see this?<select name="visibility"><option value="public">Public</option><option value="friends">Friends only</option><option value="private">Private</option></select></label><button class="button primary" type="submit">Publish post</button></form>` +
    section('Published posts', cards);
}
async function renderFriends() {
  const [{ data: links, error }, { data: follows, error: followError }] = await Promise.all([
    supabase.from('friendships').select('*').or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`).order('created_at', { ascending: false }),
    supabase.from('follows').select('*').or(`follower_id.eq.${currentUser.id},followed_id.eq.${currentUser.id}`)
  ]);
  if (error) throw error;
  if (followError) throw followError;
  const accepted = (links || []).filter(x => x.status === 'accepted');
  const incoming = (links || []).filter(x => x.status === 'pending' && x.addressee_id === currentUser.id);
  const sent = (links || []).filter(x => x.status === 'pending' && x.requester_id === currentUser.id);
  const followers = (follows || []).filter(x => x.followed_id === currentUser.id);
  const following = (follows || []).filter(x => x.follower_id === currentUser.id);
  const otherIds = [...new Set([...(links || []).map(x => x.requester_id === currentUser.id ? x.addressee_id : x.requester_id), ...(follows || []).map(x => x.follower_id === currentUser.id ? x.followed_id : x.follower_id)])];
  let people = [];
  if (otherIds.length) { const r = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', otherIds); if (r.error) throw r.error; people = r.data || []; }
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const personRows = (rows, getId, action = '') => rows.length ? `<ul class="plain-list">${rows.map(row => { const id = getId(row); return `<li class="connection-row">${profileLink({ id, ...(byId[id] || {}) })}<span class="connection-actions">${action ? action(row, id) : ''}</span></li>`; }).join('')}</ul>` : empty('Nothing here yet.');
  const incomingHtml = personRows(incoming, x => x.requester_id, x => `<button class="button primary" data-accept-friend="${x.id}">Accept</button><button class="button subtle" data-decline-friend="${x.id}">Decline</button>`);
  const sentHtml = personRows(sent, x => x.addressee_id, x => `<span class="muted">Pending</span><button class="button subtle" data-cancel-friend="${x.id}">Cancel</button>`);
  const friendsHtml = personRows(accepted, x => x.requester_id === currentUser.id ? x.addressee_id : x.requester_id, id => `<button class="button subtle" data-chat-user="${id}">Message</button>`);
  const followersHtml = personRows(followers, x => x.follower_id, (x, id) => `<button class="button subtle" data-toggle-follow="${id}">${following.some(f => f.followed_id === id) ? 'Unfollow' : 'Follow back'}</button>`);
  const followingHtml = personRows(following, x => x.followed_id);
  viewContainer.innerHTML = pageHead('Friends & followers', 'Keep your connections and requests in separate places.') +
    `<form id="user-search" class="content-form connection-search"><h3>Find someone</h3><label>Search by exact username<input name="username" placeholder="Enter username" required></label><button class="button" type="submit">Search</button><div id="search-results"></div></form>` +
    `<nav class="connection-tabs" aria-label="Connections sections">${[['friends','Friends',accepted.length],['followers','Followers',followers.length],['following','Following',following.length],['requests','Friend requests',incoming.length + sent.length]].map(([key,label,count]) => `<button type="button" class="connection-tab${key === 'friends' ? ' active' : ''}" data-friend-tab="${key}">${label}<span>${count}</span></button>`).join('')}</nav>` +
    `<section class="connection-section" data-friend-section="friends"><h3 class="section-title">Friends</h3>${friendsHtml}</section>` +
    `<section class="connection-section" data-friend-section="followers" hidden><h3 class="section-title">Followers</h3>${followersHtml}</section>` +
    `<section class="connection-section" data-friend-section="following" hidden><h3 class="section-title">Following</h3>${followingHtml}</section>` +
    `<section class="connection-section" data-friend-section="requests" hidden><h3 class="section-title">Incoming requests</h3>${incomingHtml}<h3 class="section-title request-subtitle">Sent requests</h3>${sentHtml}</section>`;
}
async function renderMessages() {
  const keepChat = activeChatUser;
  const { data: friends, error } = await supabase.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted').or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if (error) throw error;
  const friendIds = [...new Set((friends || []).map(f => f.requester_id === currentUser.id ? f.addressee_id : f.requester_id))];
  const [recentResult, unreadResult] = await Promise.all([
    supabase.from('messages').select('id,sender_id,recipient_id,body,media_path,created_at').or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).order('created_at', { ascending: false }).limit(250),
    supabase.from('messages').select('id,sender_id').eq('recipient_id', currentUser.id).is('read_at', null).order('created_at', { ascending: false })
  ]);
  if (recentResult.error) throw recentResult.error;
  if (unreadResult.error) throw unreadResult.error;
  const latestByPerson = new Map();
  for (const m of recentResult.data || []) { const other = m.sender_id === currentUser.id ? m.recipient_id : m.sender_id; if (friendIds.includes(other) && !latestByPerson.has(other)) latestByPerson.set(other, m); }
  const unreadByPerson = {};
  for (const m of unreadResult.data || []) if (friendIds.includes(m.sender_id)) unreadByPerson[m.sender_id] = (unreadByPerson[m.sender_id] || 0) + 1;
  chatProfiles = {};
  if (friendIds.length) {
    const r = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', friendIds);
    if (r.error) throw r.error;
    chatProfiles = Object.fromEntries((r.data || []).map(p => [p.id, p]));
  }
  const people = friendIds.map(id => chatProfiles[id] || { id, username: 'unknown', display_name: 'Member' });
  people.sort((a, b) => {
    const ta = latestByPerson.get(a.id)?.created_at || '';
    const tb = latestByPerson.get(b.id)?.created_at || '';
    return tb.localeCompare(ta) || a.display_name.localeCompare(b.display_name);
  });
  const list = people.length ? people.map(p => {
    const last = latestByPerson.get(p.id);
    const unread = unreadByPerson[p.id] || 0;
    const preview = last ? `${last.sender_id === currentUser.id ? 'You: ' : ''}${String(last.body || (last.media_path ? '📷 Image' : '')).slice(0, 54)}` : 'Start a conversation';
    return `<button type="button" class="friend-chat-item${keepChat === p.id ? ' active' : ''}" data-chat-user="${p.id}"><span class="avatar mini">${p.avatar_url ? `<img src="${esc(safeHttpUrl(p.avatar_url))}" alt="">` : esc(initials(p.display_name))}</span><span class="friend-chat-info"><strong>${esc(p.display_name)}</strong><small>@${esc(p.username)}</small><span class="conversation-preview">${esc(preview)}</span></span><span class="friend-chat-status"><i class="presence-dot${onlineUserIds.has(p.id) ? ' is-online' : ''}" data-presence-user="${p.id}" aria-label="${onlineUserIds.has(p.id) ? 'Online' : 'Offline'}"></i>${unread ? `<b class="conversation-unread">${unread > 99 ? '99+' : unread}</b>` : ''}</span></button>`;
  }).join('') : empty('You need an accepted friend connection before messaging.');
  viewContainer.classList.add('messages-view');
  viewContainer.innerHTML =
    `<div class="message-layout friends-message-layout"><aside class="conversation-list"><strong>Your friends</strong><label class="message-search-label"><span class="sr-only">Search friends</span><input id="message-friend-search" type="search" placeholder="Search friends…" autocomplete="off"></label><div id="message-friend-list">${list}</div><p id="message-no-results" class="muted" hidden>No matching friends.</p></aside><section class="chat-panel"><div class="chat-peer-header" id="chat-peer-header">${empty('Select a friend to start chatting.')}</div><div class="chat-messages" id="chat-messages">${empty('Your conversation will appear here.')}</div><div id="message-image-preview" class="message-image-preview" hidden></div><form id="message-form" class="chat-compose"><label class="message-attach" title="Attach an image" aria-label="Attach an image">＋<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled></label><div class="emoji-picker-wrap"><button type="button" class="emoji-toggle" data-toggle-emoji disabled aria-label="Choose emoji" title="Choose emoji">☺</button><div class="emoji-picker" id="message-emoji-picker" hidden>${["😀","😂","🥰","😍","😉","😊","😎","😭","😢","😡","👍","👎","👏","🙏","❤️","🔥","🎉","💯","🤔","🙌","😘","🤣","😅","💔","✨","🌹","☀️","💪"].map(emoji => `<button type="button" data-insert-emoji="${emoji}">${emoji}</button>`).join('')}</div></div><input name="body" placeholder="Write a message…" aria-label="Message" maxlength="5000" disabled><button class="button primary" type="submit" disabled>Send</button></form></section></div>`;
  const selected = people.find(p => p.id === keepChat);
  activeChatUser = null;
  if (selected) await openChat(selected.id);
}
async function openChat(userId) {
  if (activeChatUser && activeChatUser !== userId) {
    const oldInput = $('#message-form input[name="image"]'); if (oldInput) oldInput.value = '';
    if (messagePreviewUrl) URL.revokeObjectURL(messagePreviewUrl);
    messagePreviewUrl = null;
    const oldPreview = $('#message-image-preview'); if (oldPreview) { oldPreview.hidden = true; oldPreview.innerHTML = ''; }
  }
  activeChatUser = userId;
  const chatUrl = 'messages.html?chat=' + encodeURIComponent(userId);
  if (location.pathname.split('/').pop() === 'messages.html' && location.search !== '?chat=' + encodeURIComponent(userId)) history.replaceState({ view:'messages', chat:userId }, '', chatUrl);
  viewContainer.classList.add('messages-view', 'has-active-chat');
  const box = $('#chat-messages');
  const form = $('#message-form');
  if (!box || !form) return;
  $$('.friend-chat-item').forEach(button => button.classList.toggle('active', button.dataset.chatUser === userId));
  form.querySelector('input[name=body]').disabled = false;
  form.querySelector('input[name=image]').disabled = false;
  form.querySelector('[data-toggle-emoji]').disabled = false;
  form.querySelector('button[type=submit]').disabled = false;
  box.innerHTML = '<p class="muted">Loading conversation…</p>';
  if (!chatProfiles[userId]) {
    const profileResult = await supabase.from('profiles').select('id,username,display_name,avatar_url').eq('id', userId).maybeSingle();
    if (profileResult.data) chatProfiles[userId] = profileResult.data;
  }
  const peer = chatProfiles[userId] || { id: userId, display_name: 'Friend', username: 'unknown' };
  const otherName = peer.display_name || 'Friend';
  const peerHeader = $('#chat-peer-header');
  if (peerHeader) peerHeader.innerHTML = `<button type="button" class="chat-back-button" data-chat-back aria-label="Back to friends">‹</button>${profileLink(peer, 'View profile')}<span class="chat-peer-presence"><i class="presence-dot${onlineUserIds.has(userId) ? ' is-online' : ''}" data-presence-user="${userId}"></i>${onlineUserIds.has(userId) ? 'Online' : 'Offline'}</span>`;
  const { data, error } = await supabase.from('messages').select('*').or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${currentUser.id})`).order('created_at', { ascending: true });
  if (error) { box.innerHTML = `<p class="error-text">${esc(error.message)}</p>`; return; }
  const renderedMessages = [];
  for (const m of data || []) {
    let imageMarkup = '';
    if (m.media_path) {
      const signed = await supabase.storage.from('message-media').createSignedUrl(m.media_path, 3600);
      if (!signed.error && signed.data?.signedUrl) imageMarkup = `<button type="button" class="chat-image-open" data-chat-image="${esc(signed.data.signedUrl)}" aria-label="View attached image"><img src="${esc(signed.data.signedUrl)}" alt="${esc(m.media_name || 'Image attachment')}" loading="lazy"></button>`;
      else imageMarkup = '<span class="muted chat-image-unavailable">Image unavailable</span>';
    }
    renderedMessages.push(`<div class="chat-bubble-row ${m.sender_id === currentUser.id ? 'sent' : 'received'}"><div class="chat-bubble">${m.body ? `<div>${esc(m.body)}</div>` : ''}${imageMarkup}<span class="chat-bubble-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div></div>`);
  }
  box.innerHTML = renderedMessages.length ? renderedMessages.join('') : empty('No messages yet. Start the conversation.');
  box.scrollTop = box.scrollHeight;
  await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', userId).eq('recipient_id', currentUser.id).is('read_at', null);
  $(`.friend-chat-item[data-chat-user="${userId}"] .conversation-unread`)?.remove();
  refreshNotificationBadges();
  updatePresenceDots();
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
function openProfileCropper(input, fieldName) {
  const file = input.files?.[0];
  if (!file) return;
  const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
  if (!allowed.includes(file.type)) { toast('Use JPG, PNG, WEBP or GIF.'); input.value=''; return; }
  if (file.size > 10 * 1024 * 1024) { toast('Images must be 10 MB or smaller.'); input.value=''; return; }
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    const isAvatar = fieldName === 'avatar_url';
    const width = 360, height = isAvatar ? 360 : 120;
    const modal = document.createElement('div');
    modal.className = 'crop-modal-backdrop';
    modal.innerHTML = `<section class="crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title"><div class="crop-modal-head"><h2 id="crop-title">${isAvatar ? 'Crop profile picture' : 'Crop profile banner'}</h2><button type="button" class="icon-button" data-crop-cancel aria-label="Close">×</button></div><p class="muted">Drag the image to reposition it. Use the slider to zoom in or out.</p><canvas class="crop-canvas${isAvatar ? ' crop-circle' : ' crop-banner'}" aria-label="Image crop preview"></canvas><label class="crop-zoom">Zoom <input type="range" min="1" max="3" step="0.01" value="1" data-crop-zoom></label><div class="crop-modal-actions"><button type="button" class="button" data-crop-cancel>Cancel</button><button type="button" class="button primary" data-crop-save>Use this crop</button></div></section>`;
    document.body.append(modal);
    const canvas = modal.querySelector('canvas');
    canvas.width = width * 2; canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    const baseScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const state = { image, input, file, fieldName, modal, canvas, ctx, width, height, baseScale, zoom:1, x:(width-image.naturalWidth*baseScale)/2, y:(height-image.naturalHeight*baseScale)/2, dragging:false, lastX:0, lastY:0, objectUrl };
    activeCropper = state;
    const clamp = () => {
      const scale = state.baseScale * state.zoom;
      const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
      state.x = Math.min(0, Math.max(width-dw, state.x));
      state.y = Math.min(0, Math.max(height-dh, state.y));
    };
    const draw = () => {
      clamp(); ctx.setTransform(2,0,0,2,0,0); ctx.clearRect(0,0,width,height);
      ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0,0,width,height);
      const scale = state.baseScale * state.zoom;
      ctx.drawImage(image,state.x,state.y,image.naturalWidth*scale,image.naturalHeight*scale);
    };
    state.draw = draw; draw();
    modal.querySelector('[data-crop-zoom]').addEventListener('input', e => { const oldScale=state.baseScale*state.zoom; const nextZoom=Number(e.target.value); const nextScale=state.baseScale*nextZoom; state.x=width/2-(width/2-state.x)*(nextScale/oldScale); state.y=height/2-(height/2-state.y)*(nextScale/oldScale); state.zoom=nextZoom; draw(); });
    canvas.addEventListener('pointerdown', e => { state.dragging=true; state.lastX=e.clientX; state.lastY=e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if(!state.dragging)return; const rect=canvas.getBoundingClientRect(); state.x+=(e.clientX-state.lastX)*width/rect.width; state.y+=(e.clientY-state.lastY)*width/rect.width; state.lastX=e.clientX; state.lastY=e.clientY; draw(); });
    canvas.addEventListener('pointerup', () => state.dragging=false);
    canvas.addEventListener('pointercancel', () => state.dragging=false);
    modal.querySelectorAll('[data-crop-cancel]').forEach(b=>b.addEventListener('click',()=>closeCropper(true)));
    modal.querySelector('[data-crop-save]').addEventListener('click',()=>{
      const output=document.createElement('canvas'); output.width=width*2; output.height=height*2;
      const out=output.getContext('2d'); out.setTransform(2,0,0,2,0,0); const scale=state.baseScale*state.zoom;
      out.drawImage(image,state.x,state.y,image.naturalWidth*scale,image.naturalHeight*scale);
      output.toBlob(blob=>{
        if(!blob){toast('Could not crop this image.');return;}
        const cropped=new File([blob], `${isAvatar?'profile-picture':'profile-banner'}.png`, {type:'image/png'});
        const transfer=new DataTransfer(); transfer.items.add(cropped); input.files=transfer.files;
        closeCropper(false); toast('Crop ready. Press the upload button to save it.');
      },'image/png');
    });
  };
  image.onerror = () => { URL.revokeObjectURL(objectUrl); input.value=''; toast('Could not open that image.'); };
  image.src = objectUrl;
}
function closeCropper(clearInput) {
  if (!activeCropper) return;
  const state=activeCropper; state.modal.remove(); URL.revokeObjectURL(state.objectUrl);
  if(clearInput) state.input.value=''; activeCropper=null;
}
async function submitProfileImage(form, fieldName) {
  const file = new FormData(form).get('file');
  if (!file || !file.size) return toast('Choose an image first.');
  if (!file.type.startsWith('image/')) return toast('Please choose an image file.');
  if (file.size > 10 * 1024 * 1024) return toast('Images must be 10 MB or smaller.');
  const extension = file.type === 'image/png' ? 'png' : 'png';
  const path = `${currentUser.id}/${fieldName}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  setBusy(form, true, 'Uploading…');
  try {
    const upload = await supabase.storage.from('profile-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
    if (upload.error) throw upload.error;
    const { data } = supabase.storage.from('profile-media').getPublicUrl(path);
    const { error } = await supabase.from('profiles').update({ [fieldName]: data.publicUrl }).eq('id', currentUser.id);
    if (error) { await supabase.storage.from('profile-media').remove([path]); throw error; }
    await loadProfile(); toast(fieldName === 'avatar_url' ? 'Profile picture updated.' : 'Profile banner updated.'); renderProfile();
  } finally { setBusy(form, false); }
}
async function submitPost(form) {
  const fd = new FormData(form);
  const body = String(fd.get('body') || '').trim();
  const files = [...(form.querySelector('[name="images"]')?.files || [])];
  if (!body && !files.length) return toast('Write something or choose at least one image.');
  if (files.length > 5) return toast('You can add up to 5 images to one post.');
  const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
  for (const file of files) {
    if (!allowed.includes(file.type)) return toast('Use JPG, PNG, WEBP or GIF images.');
    if (file.size > 10 * 1024 * 1024) return toast('Each image must be 10 MB or smaller.');
  }
  setBusy(form, true, 'Publishing…');
  let postId = null;
  const uploaded = [];
  try {
    const inserted = await supabase.from('posts').insert({ user_id: currentUser.id, body: body || null, visibility: fd.get('visibility') }).select('id').single();
    if (inserted.error) throw inserted.error;
    postId = inserted.data.id;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[file.type];
      const path = `${currentUser.id}/posts/${postId}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from('user-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
      if (upload.error) throw upload.error;
      uploaded.push(path);
      const saved = await supabase.from('post_media').insert({ post_id: postId, user_id: currentUser.id, storage_path: path, mime_type: file.type, file_size: file.size, position: index });
      if (saved.error) throw saved.error;
    }
    toast('Post published.');
    await renderPosts();
  } catch (error) {
    if (uploaded.length) await supabase.storage.from('user-media').remove(uploaded);
    if (postId) await supabase.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
    throw error;
  } finally { setBusy(form, false); }
}
async function searchUser(form) {
  const username = String(new FormData(form).get('username')).trim().replace(/^@/, '').toLowerCase();
  const box = $('#search-results');
  const { data, error } = await supabase.from('profiles').select('id,username,display_name,avatar_url').eq('username', username).maybeSingle();
  if (error || !data) { box.innerHTML = `<p class="muted">${esc(error?.message || 'No public profile found with that username.')}</p>`; return; }
  if (data.id === currentUser.id) { box.innerHTML = '<p class="muted">That is your own profile.</p>'; return; }
  const { data: existing } = await supabase.from('friendships').select('id,status,requester_id,addressee_id').or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${data.id}),and(requester_id.eq.${data.id},addressee_id.eq.${currentUser.id})`).maybeSingle();
  const action = existing?.status === 'accepted' ? `<span class="relationship-label">Friends</span><button class="button" data-message-user="${data.id}">Message</button>` : existing?.status === 'pending' ? `<span class="muted">${existing.requester_id === currentUser.id ? 'Friend request sent' : 'Incoming friend request'}</span>` : existing ? `<span class="muted">${esc(existing.status)}</span>` : `<button class="button" data-add-friend="${data.id}">Add friend</button>`;
  const { data: following } = await supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', data.id).maybeSingle();
  box.innerHTML = `<div class="search-person-result">${profileLink(data)} <div class="inline-actions">${action} <button class="button" data-toggle-follow="${data.id}">${following ? 'Unfollow' : 'Follow'}</button></div></div>`;
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
  const fd = new FormData(form);
  const body = String(fd.get('body') || '').trim();
  const file = form.querySelector('input[name="image"]')?.files?.[0] || null;
  if (!body && !file) return toast('Write a message or attach an image.');
  if (body.length > 5000) return toast('Messages must be 5,000 characters or fewer.');
  let mediaPath = null;
  if (file) {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    if (!allowed.includes(file.type)) return toast('Use JPG, PNG, WEBP or GIF images.');
    if (file.size > 10 * 1024 * 1024) return toast('Images must be 10 MB or smaller.');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'image';
    mediaPath = `${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from('message-media').upload(mediaPath, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
    if (upload.error) return toast(upload.error.message);
  }
  const { error } = await supabase.from('messages').insert({ sender_id: currentUser.id, recipient_id: activeChatUser, body, media_path: mediaPath, media_type: file?.type || null, media_name: file?.name || null, media_size: file?.size || null });
  if (error) {
    if (mediaPath) await supabase.storage.from('message-media').remove([mediaPath]);
    return toast(error.message);
  }
  if (messagePreviewUrl) URL.revokeObjectURL(messagePreviewUrl);
  messagePreviewUrl = null;
  form.reset();
  const preview = $('#message-image-preview'); if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  await openChat(activeChatUser);
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

// Keep section navigation compatible with the browser's Back and Forward buttons.
window.addEventListener('popstate', () => {
  currentView = viewFromLocation(titles);
  const params = new URLSearchParams(location.search);
  viewedProfileId = params.get('member');
  activeChatUser = params.get('chat');
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === currentView));
  $('#breadcrumb').textContent = titles[currentView];
  closeMobileSidebar();
  renderView();
});

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
  if (notificationChat) { $('#notification-panel').hidden = true; notificationPanelOpen = false; go('messages', { chat: notificationChat.dataset.notificationChat }); return; }
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
  if (event.target.closest('[data-load-new-posts]')) { await renderHome(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (event.target.closest('[data-chat-back]')) { viewContainer.classList.remove('has-active-chat'); activeChatUser = null; history.replaceState({ view:'messages' }, '', 'messages.html'); return; }
  if (event.target.closest('[data-toggle-emoji]')) { const picker = $('#message-emoji-picker'); if (picker) picker.hidden = !picker.hidden; return; }
  const insertEmoji = event.target.closest('[data-insert-emoji]'); if (insertEmoji) { const input = $('#message-form input[name=body]'); if (input && !input.disabled) { const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? input.value.length; input.value = input.value.slice(0,start) + insertEmoji.dataset.insertEmoji + input.value.slice(end); input.focus(); const pos = start + insertEmoji.dataset.insertEmoji.length; input.setSelectionRange(pos,pos); } const picker = $('#message-emoji-picker'); if (picker) picker.hidden = true; return; }
  if (event.target.closest('[data-action="focus-post"]') || event.target.closest('[data-action="new-post"]')) { if (currentView !== 'posts') go('posts'); else $('#post-form textarea')?.focus(); return; }
  const delPost = event.target.closest('[data-delete-post]'); if (delPost) { if (!confirm('Delete this post?')) return; const postId = delPost.dataset.deletePost; const media = await supabase.from('post_media').select('storage_path').eq('post_id', postId); if (media.error) return toast(media.error.message); const paths = (media.data || []).map(x => x.storage_path); const removed = await supabase.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id); if (removed.error) return toast(removed.error.message); if (paths.length) await supabase.storage.from('user-media').remove(paths); toast('Post deleted.'); renderView(); return; }
  const imageButton = event.target.closest('[data-post-image]'); if (imageButton) { openPostImage(imageButton); return; }
  const chatImage = event.target.closest('[data-chat-image]'); if (chatImage) { openImageViewer([chatImage.dataset.chatImage]); return; }
  if (event.target.closest('[data-remove-message-image]')) { const input = $('#message-form input[name="image"]'); if (input) input.value = ''; if (messagePreviewUrl) URL.revokeObjectURL(messagePreviewUrl); messagePreviewUrl = null; const preview = $('#message-image-preview'); if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; }
  const likeButton = event.target.closest('[data-toggle-like]'); if (likeButton) { await togglePostLike(likeButton.dataset.toggleLike); return; }
  const commentLike = event.target.closest('[data-toggle-comment-like]'); if (commentLike) { await toggleCommentLike(commentLike.dataset.toggleCommentLike); return; }
  const likesButton = event.target.closest('[data-show-likes]'); if (likesButton) { const list = $(`[data-likers="${likesButton.dataset.showLikes}"]`); if (list) list.hidden = !list.hidden; return; }
  const editComment = event.target.closest('[data-edit-comment]'); if (editComment) { const form = $(`[data-edit-comment-form="${editComment.dataset.editComment}"]`); if (form) { form.hidden = !form.hidden; if (!form.hidden) { const input = form.querySelector('input'); input.focus(); input.setSelectionRange(input.value.length,input.value.length); } } return; }
  const replyButton = event.target.closest('[data-reply-comment]'); if (replyButton) { const form = $(`[data-reply-form="${replyButton.dataset.replyComment}"]`); if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input')?.focus(); } return; }
  const deleteComment = event.target.closest('[data-delete-comment]'); if (deleteComment) { if (!confirm('Delete this comment?')) return; const { error } = await supabase.from('post_comments').delete().eq('id', deleteComment.dataset.deleteComment).eq('user_id', currentUser.id); if (error) toast(error.message); else { toast('Comment deleted.'); renderView(); } return; }
  const openProfile = event.target.closest('[data-open-profile]'); if (openProfile) { viewedProfileId = openProfile.dataset.openProfile; go('public-profile'); return; }
  const add = event.target.closest('[data-add-friend]'); if (add) { await sendFriendRequest(add.dataset.addFriend); return; }
  const accept = event.target.closest('[data-accept-friend]'); if (accept) { await acceptFriend(accept.dataset.acceptFriend); return; }
  const follow = event.target.closest('[data-toggle-follow]'); if (follow) { const targetId = follow.dataset.toggleFollow; follow.disabled = true; const existing = await supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', targetId).maybeSingle(); if (existing.error) { follow.disabled = false; return toast(existing.error.message); } const result = existing.data ? await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('followed_id', targetId) : await supabase.from('follows').insert({ follower_id: currentUser.id, followed_id: targetId }); if (result.error) { follow.disabled = false; return toast(result.error.message); } follow.textContent = existing.data ? 'Follow' : 'Unfollow'; follow.disabled = false; toast(existing.data ? 'You unfollowed this person.' : 'You are now following this person.'); return; }
  const messageUser = event.target.closest('[data-message-user]'); if (messageUser) { const targetId = messageUser.dataset.messageUser; go('messages', { chat: targetId }); return; }
  const friendTab = event.target.closest('[data-friend-tab]'); if (friendTab) { $$('[data-friend-tab]').forEach(b => b.classList.toggle('active', b === friendTab)); $$('[data-friend-section]').forEach(panel => { panel.hidden = panel.dataset.friendSection !== friendTab.dataset.friendTab; }); return; }
  const decline = event.target.closest('[data-decline-friend], [data-cancel-friend]'); if (decline) { const id = decline.dataset.declineFriend || decline.dataset.cancelFriend; if (!confirm(decline.hasAttribute('data-decline-friend') ? 'Decline this friend request?' : 'Cancel this sent request?')) return; const { error } = await supabase.from('friendships').delete().eq('id', id); toast(error ? error.message : 'Request removed.'); if (!error) renderView(); return; }
  const chat = event.target.closest('[data-chat-user]'); if (chat) { await openChat(chat.dataset.chatUser); return; }
  const delMedia = event.target.closest('[data-delete-media]'); if (delMedia) { if (!confirm('Delete this media item?')) return; const path = delMedia.dataset.storagePath; if (path) { const r = await supabase.storage.from('user-media').remove([path]); if (r.error) return toast(r.error.message); } const r = await supabase.from('media_items').delete().eq('id', delMedia.dataset.deleteMedia).eq('user_id', currentUser.id); toast(r.error ? r.error.message : 'Media deleted.'); if (!r.error) renderView(); return; }
  const delEntry = event.target.closest('[data-delete-entry]'); if (delEntry) { if (!confirm('Delete this entry?')) return; const { error } = await supabase.from(delEntry.dataset.table).delete().eq('id', delEntry.dataset.deleteEntry).eq('user_id', currentUser.id); toast(error ? error.message : 'Entry deleted.'); if (!error) renderCollection(delEntry.dataset.table); return; }
  if (event.target.closest('#reset-password')) { const { error } = await supabase.auth.resetPasswordForEmail(currentUser.email, { redirectTo: window.location.origin }); toast(error ? error.message : 'Password reset email requested.'); }
});
document.addEventListener('input', event => {
  if (event.target.matches('#message-friend-search')) {
    const query = event.target.value.trim().toLowerCase();
    let shown = 0;
    $$('.friend-chat-item').forEach(item => { const match = item.textContent.toLowerCase().includes(query); item.hidden = !match; if (match) shown++; });
    const noResults = $('#message-no-results'); if (noResults) noResults.hidden = shown > 0;
  }
});

document.addEventListener('change', event => {
  const input = event.target;
  if (input.matches('#post-form input[name="images"]')) { const preview = $('#post-image-preview'); const files = [...(input.files || [])]; if (files.length > 5) { toast('You can add up to 5 images.'); input.value = ''; preview.innerHTML = ''; return; } preview.innerHTML = files.map(file => `<span>${esc(file.name)}</span>`).join(''); }
  else if (input.matches('#message-form input[name="image"]')) { const file = input.files?.[0]; const preview = $('#message-image-preview'); if (messagePreviewUrl) URL.revokeObjectURL(messagePreviewUrl); messagePreviewUrl = null; if (!file) { if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; } if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) { toast('Choose a JPG, PNG, WEBP or GIF image up to 10 MB.'); input.value = ''; if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; } messagePreviewUrl = URL.createObjectURL(file); if (preview) { preview.innerHTML = `<img src="${messagePreviewUrl}" alt="Image preview"><span>${esc(file.name)}</span><button type="button" class="text-button" data-remove-message-image>Remove</button>`; preview.hidden = false; } }
  else if (input.matches('#avatar-upload-form input[type=file]')) openProfileCropper(input, 'avatar_url');
  else if (input.matches('#cover-upload-form input[type=file]')) openProfileCropper(input, 'cover_url');
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
    else if (form.matches('[data-comment-form], [data-reply-form]')) await submitPostComment(form);
    else if (form.matches('[data-edit-comment-form]')) await submitEditComment(form);
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
    Promise.resolve().then(() => { if (currentUser?.id === session.user.id) go('home'); });
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) setAuthMessage(error.message, true);
  currentUser = data.session?.user || null;
  if (currentUser) { startRealtime(currentUser.id); showApp(); await renderView(); refreshNotificationBadges(); }
  else showAuth();
}
