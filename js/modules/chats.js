// Private chat between friends.
import { refreshNotificationBadges, updatePresenceDots } from './realtime.js';
import { dom, ps } from './state.js';
import { $, $$, blockedMessage, empty, esc, initials, profileLink, safeHttpUrl, toast } from './utils.js';

export async function renderChats() {
  const keepChat = ps.activeChatUser;
  const { data: friends, error } = await ps.supabase.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted').or(`requester_id.eq.${ps.currentUser.id},addressee_id.eq.${ps.currentUser.id}`);
  if (error) throw error;
  const friendIds = [...new Set((friends || []).map(f => f.requester_id === ps.currentUser.id ? f.addressee_id : f.requester_id))];
  const [recentResult, unreadResult] = await Promise.all([
    ps.supabase.from('messages').select('id,sender_id,recipient_id,body,media_path,created_at').or(`sender_id.eq.${ps.currentUser.id},recipient_id.eq.${ps.currentUser.id}`).order('created_at', { ascending: false }).limit(250),
    ps.supabase.from('messages').select('id,sender_id').eq('recipient_id', ps.currentUser.id).is('read_at', null).order('created_at', { ascending: false })
  ]);
  if (recentResult.error) throw recentResult.error;
  if (unreadResult.error) throw unreadResult.error;
  const latestByPerson = new Map();
  for (const m of recentResult.data || []) { const other = m.sender_id === ps.currentUser.id ? m.recipient_id : m.sender_id; if (friendIds.includes(other) && !latestByPerson.has(other)) latestByPerson.set(other, m); }
  const unreadByPerson = {};
  for (const m of unreadResult.data || []) if (friendIds.includes(m.sender_id)) unreadByPerson[m.sender_id] = (unreadByPerson[m.sender_id] || 0) + 1;
  ps.chatProfiles = {};
  if (friendIds.length) {
    const r = await ps.supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', friendIds);
    if (r.error) throw r.error;
    ps.chatProfiles = Object.fromEntries((r.data || []).map(p => [p.id, p]));
  }
  const people = friendIds.map(id => ps.chatProfiles[id] || { id, username: 'unknown', display_name: 'Member' });
  people.sort((a, b) => {
    const ta = latestByPerson.get(a.id)?.created_at || '';
    const tb = latestByPerson.get(b.id)?.created_at || '';
    return tb.localeCompare(ta) || a.display_name.localeCompare(b.display_name);
  });
  const list = people.length ? people.map(p => {
    const last = latestByPerson.get(p.id);
    const unread = unreadByPerson[p.id] || 0;
    const preview = last ? `${last.sender_id === ps.currentUser.id ? 'You: ' : ''}${String(last.body || (last.media_path ? '📷 Image' : '')).slice(0, 54)}` : 'Start a conversation';
    return `<button type="button" class="friend-chat-item${keepChat === p.id ? ' active' : ''}" data-chat-user="${p.id}"><span class="avatar mini">${p.avatar_url ? `<img src="${esc(safeHttpUrl(p.avatar_url))}" alt="">` : esc(initials(p.display_name))}</span><span class="friend-chat-info"><strong>${esc(p.display_name)}</strong><small>@${esc(p.username)}</small><span class="conversation-preview">${esc(preview)}</span></span><span class="friend-chat-status"><i class="presence-dot${ps.onlineUserIds.has(p.id) ? ' is-online' : ''}" data-presence-user="${p.id}" aria-label="${ps.onlineUserIds.has(p.id) ? 'Online' : 'Offline'}"></i>${unread ? `<b class="conversation-unread">${unread > 99 ? '99+' : unread}</b>` : ''}</span></button>`;
  }).join('') : empty('You need an accepted friend connection before messaging.');
  dom.viewContainer.classList.add('messages-view');
  dom.viewContainer.innerHTML =
    `<div class="message-layout friends-message-layout"><aside class="conversation-list"><strong>Your friends</strong><label class="message-search-label"><span class="sr-only">Search friends</span><input id="message-friend-search" type="search" placeholder="Search friends…" autocomplete="off"></label><div id="message-friend-list">${list}</div><p id="message-no-results" class="muted" hidden>No matching friends.</p></aside><section class="chat-panel"><div class="chat-peer-header" id="chat-peer-header">${empty('Select a friend to start chatting.')}</div><div class="chat-messages" id="chat-messages">${empty('Your conversation will appear here.')}</div><div id="message-image-preview" class="message-image-preview" hidden></div><form id="message-form" class="chat-compose"><label class="message-attach" title="Attach an image" aria-label="Attach an image">＋<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled></label><div class="emoji-picker-wrap"><button type="button" class="emoji-toggle" data-toggle-emoji disabled aria-label="Choose emoji" title="Choose emoji">☺</button><div class="emoji-picker" id="message-emoji-picker" hidden>${["😀","😂","🥰","😍","😉","😊","😎","😭","😢","😡","👍","👎","👏","🙏","❤️","🔥","🎉","💯","🤔","🙌","😘","🤣","😅","💔","✨","🌹","☀️","💪"].map(emoji => `<button type="button" data-insert-emoji="${emoji}">${emoji}</button>`).join('')}</div></div><textarea name="body" rows="2" placeholder="Write a message…" aria-label="Message" maxlength="5000" enterkeyhint="enter" disabled></textarea><button class="button primary" type="submit" disabled>Send</button></form></section></div>`;
  const selected = people.find(p => p.id === keepChat);
  ps.activeChatUser = null;
  if (selected) await openChat(selected.id);
}
export async function openChat(userId) {
  if (ps.activeChatUser && ps.activeChatUser !== userId) {
    const oldInput = $('#message-form input[name="image"]'); if (oldInput) oldInput.value = '';
    if (ps.messagePreviewUrl) URL.revokeObjectURL(ps.messagePreviewUrl);
    ps.messagePreviewUrl = null;
    const oldPreview = $('#message-image-preview'); if (oldPreview) { oldPreview.hidden = true; oldPreview.innerHTML = ''; }
  }
  ps.activeChatUser = userId;
  const chatUrl = 'chats.html?chat=' + encodeURIComponent(userId);
  if (location.pathname.split('/').pop() === 'chats.html' && location.search !== '?chat=' + encodeURIComponent(userId)) history.replaceState({ view:'messages', chat:userId }, '', chatUrl);
  dom.viewContainer.classList.add('messages-view', 'has-active-chat');
  const box = $('#chat-messages');
  const form = $('#message-form');
  if (!box || !form) return;
  $$('.friend-chat-item').forEach(button => button.classList.toggle('active', button.dataset.chatUser === userId));
  form.querySelector('textarea[name=body]').disabled = false;
  form.querySelector('input[name=image]').disabled = false;
  form.querySelector('[data-toggle-emoji]').disabled = false;
  form.querySelector('button[type=submit]').disabled = false;
  box.innerHTML = '<p class="muted">Loading conversation…</p>';
  if (!ps.chatProfiles[userId]) {
    const profileResult = await ps.supabase.from('profiles').select('id,username,display_name,avatar_url').eq('id', userId).maybeSingle();
    if (profileResult.data) ps.chatProfiles[userId] = profileResult.data;
  }
  const peer = ps.chatProfiles[userId] || { id: userId, display_name: 'Friend', username: 'unknown' };
  const otherName = peer.display_name || 'Friend';
  const peerHeader = $('#chat-peer-header');
  if (peerHeader) peerHeader.innerHTML = `<button type="button" class="chat-back-button" data-chat-back aria-label="Back to friends">‹</button>${profileLink(peer, 'View profile')}<span class="chat-peer-presence"><i class="presence-dot${ps.onlineUserIds.has(userId) ? ' is-online' : ''}" data-presence-user="${userId}"></i>${ps.onlineUserIds.has(userId) ? 'Online' : 'Offline'}</span>`;
  const { data, error } = await ps.supabase.from('messages').select('*').or(`and(sender_id.eq.${ps.currentUser.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${ps.currentUser.id})`).order('created_at', { ascending: true });
  if (error) { box.innerHTML = `<p class="error-text">${esc(error.message)}</p>`; return; }
  const renderedMessages = [];
  for (const m of data || []) {
    let imageMarkup = '';
    if (m.media_path) {
      const signed = await ps.supabase.storage.from('message-media').createSignedUrl(m.media_path, 3600);
      if (!signed.error && signed.data?.signedUrl) imageMarkup = `<button type="button" class="chat-image-open" data-chat-image="${esc(signed.data.signedUrl)}" aria-label="View attached image"><img src="${esc(signed.data.signedUrl)}" alt="${esc(m.media_name || 'Image attachment')}" loading="lazy"></button>`;
      else imageMarkup = '<span class="muted chat-image-unavailable">Image unavailable</span>';
    }
    renderedMessages.push(`<div class="chat-bubble-row ${m.sender_id === ps.currentUser.id ? 'sent' : 'received'}"><div class="chat-bubble">${m.body ? `<div>${esc(m.body)}</div>` : ''}${imageMarkup}<span class="chat-bubble-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div></div>`);
  }
  box.innerHTML = renderedMessages.length ? renderedMessages.join('') : empty('No messages yet. Start the conversation.');
  box.scrollTop = box.scrollHeight;
  await ps.supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', userId).eq('recipient_id', ps.currentUser.id).is('read_at', null);
  $(`.friend-chat-item[data-chat-user="${userId}"] .conversation-unread`)?.remove();
  refreshNotificationBadges();
  updatePresenceDots();
}
export async function submitMessage(form) {
  if (!ps.activeChatUser) return toast('Choose a friend first.');
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
    mediaPath = `${ps.currentUser.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await ps.supabase.storage.from('message-media').upload(mediaPath, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
    if (upload.error) return toast(upload.error.message);
  }
  const { error } = await ps.supabase.from('messages').insert({ sender_id: ps.currentUser.id, recipient_id: ps.activeChatUser, body, media_path: mediaPath, media_type: file?.type || null, media_name: file?.name || null, media_size: file?.size || null });
  if (error) {
    if (mediaPath) await ps.supabase.storage.from('message-media').remove([mediaPath]);
    return toast(blockedMessage(error, 'You cannot message this person.'));
  }
  if (ps.messagePreviewUrl) URL.revokeObjectURL(ps.messagePreviewUrl);
  ps.messagePreviewUrl = null;
  form.reset();
  const preview = $('#message-image-preview'); if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  await openChat(ps.activeChatUser);
}
