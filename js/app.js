import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const authScreen = $('#auth-screen');
const app = $('#app');
const viewContainer = $('#view-container');
const titles = { home:'Home', profile:'My profile', posts:'Posts', friends:'Friends & followers', messages:'Messages', images:'Images', videos:'Videos', audio:'Audio', projects:'Projects & games', movies:'Movies', recommendations:'Recommendations', settings:'Settings' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let supabase;
let currentUser = null;
let currentProfile = null;
let currentView = 'home';
let activeChatUser = null;
let renderToken = 0;

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
function showApp() { authScreen.hidden = true; app.hidden = false; $('#connection-state').textContent = 'Connected'; }
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
function go(view) {
  currentView = view in titles ? view : 'home';
  if (location.hash !== '#' + currentView) history.replaceState(null, '', '#' + currentView);
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === currentView));
  $('#breadcrumb').textContent = titles[currentView];
  $('#sidebar').classList.remove('mobile-open');
  renderView();
}
function errorText(error) { return error?.message || 'Something went wrong. Please try again.'; }
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
    const pages = { home: renderHome, profile: renderProfile, posts: renderPosts, friends: renderFriends, messages: renderMessages, images: () => renderMedia('image'), videos: () => renderMedia('video'), audio: () => renderMedia('audio'), projects: () => renderCollection('projects'), movies: () => renderCollection('movies'), recommendations: () => renderCollection('recommendations'), settings: renderSettings };
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
  viewContainer.innerHTML = pageHead('My profile', 'Edit the information attached to your account.') +
    `<div class="profile-header"><div class="avatar">${esc(initials(p.display_name))}</div><div><h2>${esc(p.display_name)}</h2><p class="muted">@${esc(p.username)}</p><p>${esc(p.bio || 'No biography added yet.')}</p></div></div>` +
    `<form id="profile-form" class="content-form"><h3>Edit profile</h3>${field('Display name','display_name',p.display_name,'text','maxlength="60" required')}${field('Username','username',p.username,'text','minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required')}<label>Biography<textarea name="bio" maxlength="300">${esc(p.bio || '')}</textarea></label>${field('Website link','website',p.website || '', 'url','placeholder="https://"')}<label>Profile visibility<select name="profile_visibility"><option value="public" ${p.profile_visibility === 'public' ? 'selected' : ''}>Public</option><option value="friends" ${p.profile_visibility === 'friends' ? 'selected' : ''}>Friends only</option></select></label><button class="button primary" type="submit">Save profile</button></form>`;
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
  const linkRows = links.length ? links.map(f => { const incoming = f.addressee_id === currentUser.id; const other = incoming ? f.requester_id : f.addressee_id; return `<li><strong>${esc(byId[other]?.display_name || 'Member')}</strong> · @${esc(byId[other]?.username || 'unknown')} <span class="muted">${incoming ? 'Incoming' : 'Outgoing'} ${esc(f.status)}</span> ${f.status === 'pending' && incoming ? `<button class="button" data-accept-friend="${f.id}">Accept</button>` : ''}</li>`; }).join('') : '';
  viewContainer.innerHTML = pageHead('Friends & followers', 'Find people and manage connection requests.') +
    `<form id="user-search" class="content-form"><h3>Find someone</h3><label>Exact username<input name="username" placeholder="username" required></label><button class="button" type="submit">Search</button><div id="search-results"></div></form>` +
    section('Friend requests and connections', linkRows ? `<ul class="plain-list">${linkRows}</ul>` : empty('No friend requests or connections yet.')) +
    section('Followers and following', follows?.length ? `<ul class="plain-list">${follows.map(f => { const outgoing = f.follower_id === currentUser.id; const other = outgoing ? f.followed_id : f.follower_id; return `<li>${outgoing ? 'You follow' : 'Follows you'} <strong>${esc(byId[other]?.display_name || 'Member')}</strong> · @${esc(byId[other]?.username || 'unknown')}</li>`; }).join('')}</ul>` : empty('No followers or followed accounts yet.'));
}
async function renderMessages() {
  const { data: friends, error } = await supabase.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted').or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if (error) throw error;
  const ids = [...new Set((friends || []).map(f => f.requester_id === currentUser.id ? f.addressee_id : f.requester_id))];
  let people = [];
  if (ids.length) { const r = await supabase.from('profiles').select('id,username,display_name').in('id', ids); if (r.error) throw r.error; people = r.data || []; }
  const list = people.length ? people.map(p => `<button type="button" data-chat-user="${p.id}">${esc(p.display_name)} <span class="muted">@${esc(p.username)}</span></button>`).join('') : empty('You need an accepted friend connection before messaging.');
  viewContainer.innerHTML = pageHead('Messages', 'Private text conversations with accepted friends.') +
    `<div class="message-layout"><div class="conversation-list"><strong>Your friends</strong>${list}</div><div class="chat-panel"><div class="chat-messages" id="chat-messages">${empty('Choose a friend to open a conversation.')}</div><form id="message-form" class="chat-compose"><input name="body" placeholder="Write a message…" aria-label="Message" maxlength="5000" required disabled><button class="button primary" type="submit" disabled>Send</button></form></div></div>`;
  activeChatUser = null;
}
async function openChat(userId) {
  activeChatUser = userId;
  const box = $('#chat-messages');
  const form = $('#message-form');
  if (!box || !form) return;
  form.querySelector('input').disabled = false;
  form.querySelector('button').disabled = false;
  box.innerHTML = '<p class="muted">Loading conversation…</p>';
  const { data, error } = await supabase.from('messages').select('*').or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${currentUser.id})`).order('created_at', { ascending: true });
  if (error) { box.innerHTML = `<p class="error-text">${esc(error.message)}</p>`; return; }
  box.innerHTML = data.length ? data.map(m => `<p class="chat-line"><strong>${m.sender_id === currentUser.id ? 'You' : 'Friend'}:</strong> ${esc(m.body)}<span class="post-meta">${new Date(m.created_at).toLocaleString()}</span></p>`).join('') : empty('No messages yet. Start the conversation.');
  box.scrollTop = box.scrollHeight;
  await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', userId).eq('recipient_id', currentUser.id).is('read_at', null);
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
  box.innerHTML = `<p><strong>${esc(data.display_name)}</strong> · @${esc(data.username)} ${action} ${following ? '<span class="muted">You follow this person</span>' : `<button class="button" data-follow-user="${data.id}">Follow</button>`}</p>`;
}
async function sendFriendRequest(id) {
  const { error } = await supabase.from('friendships').insert({ requester_id: currentUser.id, addressee_id: id, status: 'pending' });
  toast(error ? error.message : 'Friend request sent.');
  if (!error) renderFriends();
}
async function acceptFriend(id) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id).eq('addressee_id', currentUser.id);
  toast(error ? error.message : 'Friend request accepted.');
  if (!error) renderFriends();
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

// Global click handling for the sidebar and dynamically rendered controls.
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]');
  if (nav) { event.preventDefault(); go(nav.dataset.view); return; }
  const tab = event.target.closest('[data-auth-tab]'); if (tab) { setAuthTab(tab.dataset.authTab); return; }
  if (event.target.closest('#collapse-sidebar')) { $('#sidebar').classList.toggle('collapsed'); return; }
  if (event.target.closest('#mobile-menu')) { $('#sidebar').classList.toggle('mobile-open'); return; }
  if (event.target.closest('#theme-toggle') || event.target.closest('#settings-theme')) { document.body.classList.toggle('dark'); localStorage.setItem('ps-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); $('#theme-toggle').textContent = document.body.classList.contains('dark') ? 'Light theme' : 'Dark theme'; return; }
  if (event.target.closest('#logout-button')) { await supabase.auth.signOut(); currentUser = null; currentProfile = null; showAuth(); return; }
  if (event.target.closest('[data-action="retry"]')) { renderView(); return; }
  if (event.target.closest('[data-action="focus-post"]') || event.target.closest('[data-action="new-post"]')) { if (currentView !== 'posts') go('posts'); else $('#post-form textarea')?.focus(); return; }
  const delPost = event.target.closest('[data-delete-post]'); if (delPost) { if (!confirm('Delete this post?')) return; const { error } = await supabase.from('posts').delete().eq('id', delPost.dataset.deletePost).eq('user_id', currentUser.id); toast(error ? error.message : 'Post deleted.'); if (!error) renderPosts(); return; }
  const add = event.target.closest('[data-add-friend]'); if (add) { await sendFriendRequest(add.dataset.addFriend); return; }
  const accept = event.target.closest('[data-accept-friend]'); if (accept) { await acceptFriend(accept.dataset.acceptFriend); return; }
  const follow = event.target.closest('[data-follow-user]'); if (follow) { const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, followed_id: follow.dataset.followUser }); toast(error ? error.message : 'You are now following this person.'); if (!error) renderFriends(); return; }
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

if (localStorage.getItem('ps-theme') === 'dark') { document.body.classList.add('dark'); $('#theme-toggle').textContent = 'Light theme'; }
if (!isConfigured) {
  showAuth();
  setAuthMessage('Supabase configuration is missing. Check js/config.js.', true);
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (!currentUser) { currentProfile = null; showAuth(); return; }
    showApp();
    // Avoid awaiting Supabase calls inside its auth callback.
    Promise.resolve().then(() => { if (currentUser?.id === session.user.id) go(location.hash.slice(1) || 'home'); });
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) setAuthMessage(error.message, true);
  currentUser = data.session?.user || null;
  if (currentUser) { showApp(); await renderView(); }
  else showAuth();
}
