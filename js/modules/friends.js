// Friends, followers, requests and the blocked list.
import { renderView } from './router.js';
import { dom, ps } from './state.js';
import { $, blockedMessage, empty, esc, pageHead, profileLink, toast } from './utils.js';

export async function renderFriends() {
  const [{ data: links, error }, { data: follows, error: followError }, { data: blockRows, error: blockError }] = await Promise.all([
    ps.supabase.from('friendships').select('*').or(`requester_id.eq.${ps.currentUser.id},addressee_id.eq.${ps.currentUser.id}`).order('created_at', { ascending: false }),
    ps.supabase.from('follows').select('*').or(`follower_id.eq.${ps.currentUser.id},followed_id.eq.${ps.currentUser.id}`),
    ps.supabase.from('blocks').select('blocked_id').eq('blocker_id', ps.currentUser.id)
  ]);
  if (error) throw error;
  if (followError) throw followError;
  if (blockError) throw blockError;
  const blocked = blockRows || [];
  const accepted = (links || []).filter(x => x.status === 'accepted');
  const incoming = (links || []).filter(x => x.status === 'pending' && x.addressee_id === ps.currentUser.id);
  const sent = (links || []).filter(x => x.status === 'pending' && x.requester_id === ps.currentUser.id);
  const followers = (follows || []).filter(x => x.followed_id === ps.currentUser.id);
  const following = (follows || []).filter(x => x.follower_id === ps.currentUser.id);
  const otherIds = [...new Set([...(links || []).map(x => x.requester_id === ps.currentUser.id ? x.addressee_id : x.requester_id), ...(follows || []).map(x => x.follower_id === ps.currentUser.id ? x.followed_id : x.follower_id), ...blocked.map(x => x.blocked_id)])];
  let people = [];
  if (otherIds.length) { const r = await ps.supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', otherIds); if (r.error) throw r.error; people = r.data || []; }
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const personRows = (rows, getId, action = '') => rows.length ? `<ul class="plain-list">${rows.map(row => { const id = getId(row); return `<li class="connection-row">${profileLink({ id, ...(byId[id] || {}) })}<span class="connection-actions">${action ? action(row, id) : ''}</span></li>`; }).join('')}</ul>` : empty('Nothing here yet.');
  const incomingHtml = personRows(incoming, x => x.requester_id, x => `<button class="button primary" data-accept-friend="${x.id}">Accept</button><button class="button subtle" data-decline-friend="${x.id}">Decline</button>`);
  const sentHtml = personRows(sent, x => x.addressee_id, x => `<span class="muted">Pending</span><button class="button subtle" data-cancel-friend="${x.id}">Cancel</button>`);
  const friendsHtml = personRows(accepted, x => x.requester_id === ps.currentUser.id ? x.addressee_id : x.requester_id, id => `<button class="button subtle" data-chat-user="${id}">Message</button>`);
  const followersHtml = personRows(followers, x => x.follower_id, (x, id) => `<button class="button subtle" data-toggle-follow="${id}">${following.some(f => f.followed_id === id) ? 'Unfollow' : 'Follow back'}</button>`);
  const followingHtml = personRows(following, x => x.followed_id);
  const blockedHtml = personRows(blocked, x => x.blocked_id, (x, id) => `<button class="button subtle" type="button" data-unblock-user="${id}">Unblock</button>`);
  dom.viewContainer.innerHTML = pageHead('Friends & followers', 'Keep your connections and requests in separate places.') +
    `<form id="user-search" class="content-form connection-search"><h3>Find someone</h3><label>Search by exact username<input name="username" placeholder="Enter username" required></label><button class="button" type="submit">Search</button><div id="search-results"></div></form>` +
    `<nav class="connection-tabs" aria-label="Connections sections">${[['friends','Friends',accepted.length],['followers','Followers',followers.length],['following','Following',following.length],['requests','Friend requests',incoming.length + sent.length],['blocked','Blocked',blocked.length]].map(([key,label,count]) => `<button type="button" class="connection-tab${key === 'friends' ? ' active' : ''}" data-friend-tab="${key}">${label}<span>${count}</span></button>`).join('')}</nav>` +
    `<section class="connection-section" data-friend-section="friends"><h3 class="section-title">Friends</h3>${friendsHtml}</section>` +
    `<section class="connection-section" data-friend-section="followers" hidden><h3 class="section-title">Followers</h3>${followersHtml}</section>` +
    `<section class="connection-section" data-friend-section="following" hidden><h3 class="section-title">Following</h3>${followingHtml}</section>` +
    `<section class="connection-section" data-friend-section="requests" hidden><h3 class="section-title">Incoming requests</h3>${incomingHtml}<h3 class="section-title request-subtitle">Sent requests</h3>${sentHtml}</section>` +
    `<section class="connection-section" data-friend-section="blocked" hidden><h3 class="section-title">Blocked people</h3><p class="muted">Blocked people cannot see your profile or posts, or message you.</p>${blockedHtml}</section>`;
}
export async function searchUser(form) {
  const username = String(new FormData(form).get('username')).trim().replace(/^@/, '').toLowerCase();
  const box = $('#search-results');
  const { data, error } = await ps.supabase.from('profiles').select('id,username,display_name,avatar_url').eq('username', username).maybeSingle();
  if (error || !data) { box.innerHTML = `<p class="muted">${esc(error?.message || 'No public profile found with that username.')}</p>`; return; }
  if (data.id === ps.currentUser.id) { box.innerHTML = '<p class="muted">That is your own profile.</p>'; return; }
  const { data: existing } = await ps.supabase.from('friendships').select('id,status,requester_id,addressee_id').or(`and(requester_id.eq.${ps.currentUser.id},addressee_id.eq.${data.id}),and(requester_id.eq.${data.id},addressee_id.eq.${ps.currentUser.id})`).maybeSingle();
  const action = existing?.status === 'accepted' ? `<span class="relationship-label">Friends</span><button class="button" data-message-user="${data.id}">Message</button>` : existing?.status === 'pending' ? `<span class="muted">${existing.requester_id === ps.currentUser.id ? 'Friend request sent' : 'Incoming friend request'}</span>` : existing ? `<span class="muted">${esc(existing.status)}</span>` : `<button class="button" data-add-friend="${data.id}">Add friend</button>`;
  const { data: following } = await ps.supabase.from('follows').select('follower_id').eq('follower_id', ps.currentUser.id).eq('followed_id', data.id).maybeSingle();
  box.innerHTML = `<div class="search-person-result">${profileLink(data)} <div class="inline-actions">${action} <button class="button" data-toggle-follow="${data.id}">${following ? 'Unfollow' : 'Follow'}</button></div></div>`;
}
export async function sendFriendRequest(id) {
  const { error } = await ps.supabase.from('friendships').insert({ requester_id: ps.currentUser.id, addressee_id: id, status: 'pending' });
  toast(error ? blockedMessage(error, 'You cannot send a request to this person.') : 'Friend request sent.');
  if (!error) renderView();
}
export async function acceptFriend(id) {
  const { error } = await ps.supabase.from('friendships').update({ status: 'accepted' }).eq('id', id).eq('addressee_id', ps.currentUser.id);
  toast(error ? error.message : 'Friend request accepted.');
  if (!error) renderView();
}
