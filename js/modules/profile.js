// Your profile, other members' profiles and picture cropping.
import { buildPostCards } from './posts.js';
import { go } from './router.js';
import { updateIdentity } from './shell.js';
import { dom, ps } from './state.js';
import { adoptProfilePrefs } from './theme.js';
import { entryBody, esc, field, initials, pageHead, safeHttpUrl, section, setBusy, toast } from './utils.js';

export async function loadProfile() {
  const { data, error } = await ps.supabase.from('profiles').select('*').eq('id', ps.currentUser.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Your account exists, but its profile record was not created. Please contact support before creating another account.');
  ps.currentProfile = data;
  adoptProfilePrefs(data);
  updateIdentity();
}
export async function renderProfile() {
  const p = ps.currentProfile;
  const avatarUrl = safeHttpUrl(p.avatar_url);
  const coverUrl = safeHttpUrl(p.cover_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="Profile picture">` : esc(initials(p.display_name));
  const cover = coverUrl ? `<img class="profile-cover-preview" src="${esc(coverUrl)}" alt="Profile banner">` : '<div class="profile-cover-empty">No banner added yet</div>';
  dom.viewContainer.innerHTML = pageHead('My profile', 'Edit your profile and choose the images people see when they visit your space.') +
    `<div class="profile-cover-wrap">${cover}</div><div class="profile-header"><div class="avatar">${avatar}</div><div><h2>${esc(p.display_name)}</h2><p class="muted">@${esc(p.username)}</p><p>${esc(p.bio || 'No biography added yet.')}</p></div></div>` +
    `<div class="profile-image-controls"><form id="avatar-upload-form" class="content-form profile-upload-form"><h3>Profile picture</h3><p class="muted">Choose a square image if possible. JPG, PNG, WEBP or GIF, up to 10 MB.</p><label>Choose profile picture<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="button" type="submit">Upload profile picture</button></form><form id="cover-upload-form" class="content-form profile-upload-form"><h3>Profile banner</h3><p class="muted">A wide image works best. JPG, PNG, WEBP or GIF, up to 10 MB.</p><label>Choose banner image<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="button" type="submit">Upload banner</button></form></div>` +
    `<form id="profile-form" class="content-form"><h3>Edit profile details</h3>${field('Display name','display_name',p.display_name,'text','maxlength="60" required')}${field('Username','username',p.username,'text','minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required')}<label>Biography<textarea name="bio" maxlength="300">${esc(p.bio || '')}</textarea></label>${field('Website link','website',p.website || '', 'url','placeholder="https://"')}<label>Profile visibility<select name="profile_visibility"><option value="public" ${p.profile_visibility === 'public' ? 'selected' : ''}>Public</option><option value="friends" ${p.profile_visibility === 'friends' ? 'selected' : ''}>Friends only</option></select></label><button class="button primary" type="submit">Save profile</button></form>`;
}
export async function renderPublicProfile() {
  if (!ps.viewedProfileId || ps.viewedProfileId === ps.currentUser.id) { go('profile'); return; }
  const { data: person, error } = await ps.supabase.from('profiles').select('id,username,display_name,bio,avatar_url,cover_url,website,profile_visibility,created_at').eq('id', ps.viewedProfileId).maybeSingle();
  if (error) throw error;
  if (!person) {
    dom.viewContainer.innerHTML = pageHead('Profile unavailable', 'This profile may be private or no longer available.') + '<button class="button" data-view="friends">Back to people</button>';
    return;
  }
  const [{ data: posts, error: postError }, { data: friendship }, { data: following }, { data: iBlocked }, projectsRes, moviesRes, recsRes] = await Promise.all([
    ps.supabase.from('posts').select('id,user_id,body,visibility,created_at').eq('user_id', person.id).order('created_at', { ascending: false }).limit(50),
    ps.supabase.from('friendships').select('id,status,requester_id,addressee_id').or(`and(requester_id.eq.${ps.currentUser.id},addressee_id.eq.${person.id}),and(requester_id.eq.${person.id},addressee_id.eq.${ps.currentUser.id})`).maybeSingle(),
    ps.supabase.from('follows').select('follower_id').eq('follower_id', ps.currentUser.id).eq('followed_id', person.id).maybeSingle(),
    ps.supabase.from('blocks').select('blocked_id').eq('blocker_id', ps.currentUser.id).eq('blocked_id', person.id).maybeSingle(),
    ps.supabase.from('projects').select('*').eq('user_id', person.id).eq('visibility', 'public').order('created_at', { ascending: false }).limit(30),
    ps.supabase.from('movies').select('*').eq('user_id', person.id).eq('visibility', 'public').order('created_at', { ascending: false }).limit(30),
    ps.supabase.from('recommendations').select('*').eq('user_id', person.id).eq('visibility', 'public').order('created_at', { ascending: false }).limit(30)
  ]);
  if (postError) throw postError;
  const avatarUrl = safeHttpUrl(person.avatar_url);
  const coverUrl = safeHttpUrl(person.cover_url);
  const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="${esc(person.display_name)}" style="width:100%;height:100%;object-fit:cover">` : esc(initials(person.display_name));
  const cover = coverUrl ? `<img src="${esc(coverUrl)}" alt="${esc(person.display_name)} cover" style="width:100%;max-height:190px;object-fit:cover;border:1px solid var(--line);margin-bottom:16px">` : '';
  const friendshipAction = friendship?.status === 'accepted' ? '<span class="relationship-label">Friends</span><button class="button" data-message-user="' + person.id + '">Message</button>' : friendship?.status === 'pending' ? `<span class="muted">${friendship.requester_id === ps.currentUser.id ? 'Friend request sent' : 'They sent you a friend request'}</span>` : friendship ? `<span class="muted">${esc(friendship.status)}</span>` : `<button class="button" data-add-friend="${person.id}">Add friend</button>`;
  const followAction = following ? `<button class="button" data-toggle-follow="${person.id}">Unfollow</button>` : `<button class="button" data-toggle-follow="${person.id}">Follow</button>`;
  const websiteUrl = safeHttpUrl(person.website);
  const website = websiteUrl ? `<p><a href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">${esc(person.website)}</a></p>` : '';
  const postRows = iBlocked ? '' : await buildPostCards(posts || []);
  const showcase = (title, result) => (!iBlocked && result?.data?.length) ? section(title, `<ul class="plain-list">${result.data.map(item => `<li>${entryBody(item)}</li>`).join('')}</ul>`) : '';
  const actions = iBlocked
    ? `<span class="muted">You blocked this person.</span><button class="button" type="button" data-unblock-user="${person.id}">Unblock</button>`
    : `${friendshipAction}${followAction}<button class="button subtle" type="button" data-report-user="${person.id}">Report</button><button class="button subtle danger" type="button" data-block-user="${person.id}">Block</button>`;
  const joined = person.created_at ? `Member since ${new Date(person.created_at).toLocaleDateString()}` : '';
  dom.viewContainer.innerHTML = pageHead('Member profile', `A look at what ${person.display_name} has chosen to share.`, '<button class="button" data-view="friends">Back to people</button>') + cover +
    `<div class="profile-header"><div class="avatar">${avatar}</div><div><h2>${esc(person.display_name)}</h2><p class="muted">@${esc(person.username)}</p><p>${esc(person.bio || 'No biography added.')}</p>${website}<p class="post-meta">${esc(joined)}</p><div class="inline-actions">${actions}</div></div></div>` +
    (iBlocked ? '' : section('Publications', postRows)) + showcase('Projects & games', projectsRes) + showcase('Movies', moviesRes) + showcase('Recommendations', recsRes);
}
export async function submitProfile(form) {
  const fd = new FormData(form);
  const username = String(fd.get('username')).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return toast('Username must be 3–24 letters, numbers or underscores.');
  const { error } = await ps.supabase.from('profiles').update({ display_name: String(fd.get('display_name')).trim(), username, bio: fd.get('bio') || '', website: fd.get('website') || null, profile_visibility: fd.get('profile_visibility') }).eq('id', ps.currentUser.id);
  if (error) return toast(error.message);
  await loadProfile(); toast('Profile saved.'); renderProfile();
}
export function openProfileCropper(input, fieldName) {
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
    ps.activeCropper = state;
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
export function closeCropper(clearInput) {
  if (!ps.activeCropper) return;
  const state=ps.activeCropper; state.modal.remove(); URL.revokeObjectURL(state.objectUrl);
  if(clearInput) state.input.value=''; ps.activeCropper=null;
}
export async function submitProfileImage(form, fieldName) {
  const file = new FormData(form).get('file');
  if (!file || !file.size) return toast('Choose an image first.');
  if (!file.type.startsWith('image/')) return toast('Please choose an image file.');
  if (file.size > 10 * 1024 * 1024) return toast('Images must be 10 MB or smaller.');
  const extension = file.type === 'image/png' ? 'png' : 'png';
  const path = `${ps.currentUser.id}/${fieldName}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  setBusy(form, true, 'Uploading…');
  try {
    const upload = await ps.supabase.storage.from('profile-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
    if (upload.error) throw upload.error;
    const { data } = ps.supabase.storage.from('profile-media').getPublicUrl(path);
    const { error } = await ps.supabase.from('profiles').update({ [fieldName]: data.publicUrl }).eq('id', ps.currentUser.id);
    if (error) { await ps.supabase.storage.from('profile-media').remove([path]); throw error; }
    await loadProfile(); toast(fieldName === 'avatar_url' ? 'Profile picture updated.' : 'Profile banner updated.'); renderProfile();
  } finally { setBusy(form, false); }
}
