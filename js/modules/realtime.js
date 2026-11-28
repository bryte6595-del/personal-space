// Live updates, online dots and notifications.
import { openChat, renderChats } from './chats.js';
import { renderView } from './router.js';
import { ps } from './state.js';
import { $, $$, errorText, esc, isTypingInView, toast } from './utils.js';

export function stopRealtime() {
  if (ps.realtimeRefreshTimer) window.clearTimeout(ps.realtimeRefreshTimer);
  ps.realtimeRefreshTimer = null;
  if (ps.realtimeChannel) ps.supabase.removeChannel(ps.realtimeChannel);
  ps.realtimeChannel = null;
  if (ps.presenceChannel) ps.supabase.removeChannel(ps.presenceChannel);
  ps.presenceChannel = null;
  ps.onlineUserIds = new Set();
  ps.realtimeUserId = null;
}
export function updatePresenceDots() {
  $$('[data-presence-user]').forEach(dot => {
    const online = ps.onlineUserIds.has(dot.dataset.presenceUser);
    dot.classList.toggle('is-online', online);
    dot.setAttribute('aria-label', online ? 'Online' : 'Offline');
    dot.title = online ? 'Online' : 'Offline';
    if (dot.classList.contains('presence-dot') && dot.parentElement?.classList.contains('chat-peer-presence')) dot.parentElement.lastChild.textContent = online ? 'Online' : 'Offline';
  });
}
export function scheduleRealtimeRefresh(payload) {
  if (!ps.currentUser || !payload) return;
  const row = payload.new || payload.old || {};
  const table = payload.table;
  let relevant = false;
  if (table === 'messages') {
    const otherId = row.sender_id === ps.currentUser.id ? row.recipient_id : row.sender_id;
    if (ps.currentView === 'messages' && payload.eventType === 'INSERT') {
      if (ps.realtimeRefreshTimer) window.clearTimeout(ps.realtimeRefreshTimer);
      ps.realtimeRefreshTimer = window.setTimeout(() => {
        ps.realtimeRefreshTimer = null;
        if (!ps.currentUser || ps.currentView !== 'messages') return;
        if (ps.activeChatUser === otherId) openChat(otherId);
        else if (!isTypingInView()) renderChats();
      }, 250);
    }
    return;
  }
  if (table === 'posts') {
    if (ps.currentView === 'home' && payload.eventType === 'INSERT' && row.user_id !== ps.currentUser.id) { showNewPostsIndicator(); return; }
    relevant = (ps.currentView === 'home' && payload.eventType !== 'INSERT') || (ps.currentView === 'posts' && row.user_id === ps.currentUser.id) || (ps.currentView === 'public-profile' && row.user_id === ps.viewedProfileId);
  }
  else if (table === 'post_likes' || table === 'post_comment_likes') return;
  else if (['post_media','post_comments'].includes(table)) relevant = ['home','posts','public-profile'].includes(ps.currentView);
  else if (table === 'friendships' || table === 'follows') relevant = ps.currentView === 'friends' || ps.currentView === 'public-profile';
  else if (table === 'profiles') relevant = (ps.currentView === 'profile' && row.id === ps.currentUser.id) || (ps.currentView === 'public-profile' && row.id === ps.viewedProfileId);
  else if (table === 'media_items') relevant = (row.user_id === ps.currentUser.id) && ['images','videos','audio'].includes(ps.currentView);
  else if (['projects','movies','recommendations'].includes(table)) relevant = ps.currentView === table && row.user_id === ps.currentUser.id;
  if (!relevant) return;
  if (ps.realtimeRefreshTimer) window.clearTimeout(ps.realtimeRefreshTimer);
  ps.realtimeRefreshTimer = window.setTimeout(() => { ps.realtimeRefreshTimer = null; if (ps.currentUser && !isTypingInView()) renderView(); }, 450);
}
export function showNewPostsIndicator() {
  if (ps.currentView !== 'home' || !$('.section') || $('#new-posts-indicator')) return;
  const feed = $('.post-feed') || $('.section');
  feed.insertAdjacentHTML('beforebegin', '<div class="new-posts-banner-wrap"><button type="button" id="new-posts-indicator" class="button primary new-posts-indicator" data-load-new-posts>↑ New posts · View latest</button></div>');
}
export function postSeenKey() { return `ps-posts-seen-${ps.currentUser?.id || 'guest'}`; }
export function getPostSeenAt() {
  let value = localStorage.getItem(postSeenKey());
  if (!value) { value = new Date().toISOString(); localStorage.setItem(postSeenKey(), value); }
  return value;
}
export function setPostSeenAt(value = new Date().toISOString()) { localStorage.setItem(postSeenKey(), value); }
export function initNotificationUI() {
  if ($('#notification-button')) return;
  const actions = $('.topbar-actions');
  if (!actions) return;
  actions.insertAdjacentHTML('afterbegin', `<div class="notification-wrap"><button id="notification-button" class="icon-button topbar-icon notification-button" type="button" aria-label="Notifications" aria-expanded="false" data-tooltip="Notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><span id="notification-badge" class="notification-badge" hidden>0</span></button><div id="notification-panel" class="notification-panel" hidden><div class="notification-panel-head"><strong>Notifications</strong><button type="button" id="notification-close" class="text-button">Close</button></div><div id="notification-content"><p class="muted">Loading…</p></div></div></div>`);
  const style = document.createElement('style');
  style.textContent = `.notification-wrap{position:relative}.notification-badge,.nav-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:10px;background:var(--danger);color:white;font-size:11px;font-weight:700}.notification-badge{position:absolute;top:-4px;right:-5px;border:2px solid var(--paper)}.nav-count{margin-left:auto}.notification-panel{position:absolute;right:0;top:calc(100% + 10px);width:min(370px,calc(100vw - 28px));max-height:min(72vh,540px);overflow:auto;overscroll-behavior:contain;background:var(--paper);border:1px solid var(--line);z-index:40;padding:14px;box-shadow:0 5px 18px #0002}.notification-panel-head{display:flex;justify-content:space-between;align-items:center;position:sticky;top:-14px;background:var(--paper);border-bottom:1px solid var(--line);padding:8px 0 10px;margin-bottom:8px;z-index:1}.notification-group{margin:12px 0}.notification-group h4{font-size:12px;color:var(--muted);margin:0 0 5px;text-transform:uppercase;letter-spacing:.05em}.notification-item{display:block;width:100%;text-align:left;padding:10px 6px;background:none;color:var(--text);border:0;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.notification-item:hover{background:var(--soft)}.notification-item small{display:block;margin-top:4px;overflow-wrap:anywhere}.notification-empty{font-size:13px;color:var(--muted);padding:8px 0}.sidebar .nav-link{gap:9px}@media(max-width:760px){.notification-panel{position:fixed;top:68px;left:10px;right:10px;width:auto;max-height:calc(100vh - 82px);max-height:calc(100dvh - 82px);padding:12px}.notification-panel-head{top:-12px}}`;
  document.head.appendChild(style);
}
export async function refreshNotificationBadges() {
  if (!ps.currentUser || !ps.supabase) return;
  try {
    const [messages, requests, follows] = await Promise.all([
      ps.supabase.from('messages').select('id', { count:'exact', head:true }).eq('recipient_id', ps.currentUser.id).is('read_at', null),
      ps.supabase.from('friendships').select('id', { count:'exact', head:true }).eq('addressee_id', ps.currentUser.id).eq('status', 'pending'),
      ps.supabase.from('follows').select('followed_id').eq('follower_id', ps.currentUser.id)
    ]);
    const unread = messages.count || 0;
    const pending = requests.count || 0;
    let newPosts = 0;
    const followedIds = [...new Set((follows.data || []).map(x => x.followed_id))];
    if (followedIds.length) {
      const postCount = await ps.supabase.from('posts').select('id', { count:'exact', head:true }).in('user_id', followedIds).gt('created_at', getPostSeenAt());
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
export async function loadNotificationPanel() {
  const content = $('#notification-content');
  if (!content || !ps.currentUser) return;
  content.innerHTML = '<p class="muted">Loading…</p>';
  const since = getPostSeenAt();
  const [messages, requests, follows] = await Promise.all([
    ps.supabase.from('messages').select('id,sender_id,body,media_path,created_at').eq('recipient_id', ps.currentUser.id).is('read_at', null).order('created_at', { ascending:false }).limit(8),
    ps.supabase.from('friendships').select('id,requester_id,created_at').eq('addressee_id', ps.currentUser.id).eq('status','pending').order('created_at', { ascending:false }).limit(8),
    ps.supabase.from('follows').select('followed_id').eq('follower_id', ps.currentUser.id)
  ]);
  if (messages.error || requests.error || follows.error) { content.innerHTML = `<p class="notification-empty">${esc(errorText(messages.error || requests.error || follows.error))}</p>`; return; }
  const followedIds = [...new Set((follows.data || []).map(x => x.followed_id))];
  let posts = { data:[], error:null };
  if (followedIds.length) posts = await ps.supabase.from('posts').select('id,user_id,body,created_at').in('user_id', followedIds).gt('created_at', since).order('created_at', { ascending:false }).limit(8);
  if (posts.error) { content.innerHTML = `<p class="notification-empty">${esc(posts.error.message)}</p>`; return; }
  const ids = [...new Set([...(messages.data || []).map(x => x.sender_id), ...(requests.data || []).map(x => x.requester_id), ...(posts.data || []).map(x => x.user_id)])];
  let profiles = [];
  if (ids.length) { const result = await ps.supabase.from('profiles').select('id,display_name,username,avatar_url').in('id', ids); if (!result.error) profiles = result.data || []; }
  const names = Object.fromEntries(profiles.map(x => [x.id, x.display_name || x.username || 'Member']));
  const group = (title, rows, renderer) => rows.length ? `<div class="notification-group"><h4>${title}</h4>${rows.map(renderer).join('')}</div>` : '';
  const messageHtml = group('Unread chats', messages.data || [], x => `<button class="notification-item" data-notification-chat="${x.sender_id}">New message from <strong>${esc(names[x.sender_id] || 'Member')}</strong><small>${esc(String(x.body || (x.media_path ? '📷 Image attachment' : '')).slice(0,90))} · ${new Date(x.created_at).toLocaleString()}</small></button>`);
  const requestHtml = group('Friend requests', requests.data || [], x => `<button class="notification-item" data-notification-friends="${x.id}"><strong>${esc(names[x.requester_id] || 'Someone')}</strong> sent you a friend request<small>${new Date(x.created_at).toLocaleString()}</small></button>`);
  const postHtml = group('New posts from people you follow', posts.data || [], x => `<button class="notification-item" data-notification-post="${x.user_id}" data-post-created="${esc(x.created_at)}"><strong>${esc(names[x.user_id] || 'Member')}</strong> published a post<small>${esc(String(x.body || '').slice(0,90))} · ${new Date(x.created_at).toLocaleString()}</small></button>`);
  content.innerHTML = messageHtml + requestHtml + postHtml || '<p class="notification-empty">You are all caught up.</p>';
  if (posts.data?.length) setPostSeenAt(posts.data[0].created_at);
  await refreshNotificationBadges();
}
export async function handleRealtimeNotification(payload) {
  if (!ps.currentUser || payload.eventType !== 'INSERT') return;
  const row = payload.new || {};
  if (payload.table === 'messages' && row.recipient_id === ps.currentUser.id) {
    const { data } = await ps.supabase.from('profiles').select('display_name').eq('id', row.sender_id).maybeSingle();
    toast(`New message from ${data?.display_name || 'someone'}`);
  } else if (payload.table === 'friendships' && row.addressee_id === ps.currentUser.id && row.status === 'pending') {
    const { data } = await ps.supabase.from('profiles').select('display_name').eq('id', row.requester_id).maybeSingle();
    toast(`New friend request from ${data?.display_name || 'someone'}`);
  } else if (payload.table === 'posts' && row.user_id !== ps.currentUser.id) {
    const { data: follow } = await ps.supabase.from('follows').select('follower_id').eq('follower_id', ps.currentUser.id).eq('followed_id', row.user_id).maybeSingle();
    if (follow) {
      const { data } = await ps.supabase.from('profiles').select('display_name').eq('id', row.user_id).maybeSingle();
      toast(`New post from ${data?.display_name || 'someone you follow'}`);
    }
  }
  if (ps.notificationRefreshTimer) window.clearTimeout(ps.notificationRefreshTimer);
  ps.notificationRefreshTimer = window.setTimeout(() => { ps.notificationRefreshTimer = null; refreshNotificationBadges(); }, 300);
}
export function startRealtime(userId) {
  if (!ps.supabase || !userId) return;
  if (ps.realtimeUserId === userId && ps.realtimeChannel) return;
  stopRealtime();
  ps.realtimeUserId = userId;
  initNotificationUI();
  const tables = ['profiles','posts','post_media','post_likes','post_comments','post_comment_likes','friendships','follows','messages','media_items','projects','movies','recommendations'];
  let channel = ps.supabase.channel(`personal-space-live-${userId}`);
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      if (payload.table === 'messages' && payload.eventType !== 'INSERT') return;
      handleRealtimeNotification(payload);
      scheduleRealtimeRefresh(payload);
    });
  }
  ps.realtimeChannel = channel.subscribe(() => {});
  ps.presenceChannel = ps.supabase.channel('personal-space-presence', { config: { presence: { key: userId } } });
  ps.presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = ps.presenceChannel.presenceState();
      const ids = new Set();
      for (const [key, metas] of Object.entries(state)) {
        if ((metas || []).some(meta => meta.user_id === key || meta.user_id)) ids.add(key);
      }
      ps.onlineUserIds = ids;
      updatePresenceDots();
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') await ps.presenceChannel.track({ user_id: userId, online_at: new Date().toISOString() });
    });
  refreshNotificationBadges();
}
