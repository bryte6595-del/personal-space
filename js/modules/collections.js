// Media, Projects, Movies and Recommendations.
import { dom, ps } from './state.js';
import { empty, entryBody, esc, field, pageHead, safeHttpUrl, section, toast } from './utils.js';

export async function renderMedia(kind) {
  const label = { image: 'Images', video: 'Videos', audio: 'Audio' }[kind];
  const { data: items, error } = await ps.supabase.from('media_items').select('*').eq('user_id', ps.currentUser.id).eq('media_type', kind).order('created_at', { ascending: false });
  if (error) throw error;
  const rendered = [];
  for (const item of items) {
    let url = safeHttpUrl(item.public_url) || null;
    if (item.storage_path) { const signed = await ps.supabase.storage.from('user-media').createSignedUrl(item.storage_path, 3600); if (!signed.error) url = signed.data.signedUrl; }
    const media = url ? (kind === 'image' ? `<img class="media-preview" src="${esc(url)}" alt="${esc(item.title)}">` : kind === 'video' ? `<video class="media-preview" controls src="${esc(url)}"></video>` : `<audio controls src="${esc(url)}"></audio>`) : '<p class="muted">File link unavailable.</p>';
    rendered.push(`<li><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p>${media}<span class="post-meta">${esc(item.visibility)} · ${new Date(item.created_at).toLocaleDateString()}</span><button class="text-button" data-delete-media="${item.id}" data-storage-path="${esc(item.storage_path || '')}">Delete</button></li>`);
  }
  dom.viewContainer.innerHTML = pageHead(label, `Upload ${kind} to your private library. Files are private to your account in this version.`) +
    `<form id="media-form" class="content-form"><h3>Add ${kind}</h3>${field('Title','title','','text','required maxlength="120"')}<label>Select file<input name="file" type="file" accept="${kind}/*" required></label><label>Description<textarea name="description" maxlength="500"></textarea></label><button class="button primary" type="submit">Upload ${kind}</button><small>Maximum file size: 50 MB.</small></form>` +
    section('Your library', rendered.length ? `<ul class="plain-list">${rendered.join('')}</ul>` : empty(`No ${kind} uploaded yet.`));
}
export const collectionConfig = {
  projects: { title: 'Projects & games', fields: ['title','description','url','github_url','status'], labels: { title:'Title',description:'Description',url:'Live link',github_url:'GitHub link',status:'Status' } },
  movies: { title: 'Movies', fields: ['title','release_year','rating','watched_on','review'], labels: { title:'Title',release_year:'Release year',rating:'Your rating (0–10)',watched_on:'Date watched',review:'Your review' } },
  recommendations: { title: 'Recommendations', fields: ['title','description','url','category','affiliate_disclosure'], labels: { title:'Title',description:'Description',url:'Link',category:'Category',affiliate_disclosure:'Affiliate disclosure' } }
};
export async function renderCollection(table) {
  const cfg = collectionConfig[table];
  const { data, error } = await ps.supabase.from(table).select('*').eq('user_id', ps.currentUser.id).order('created_at', { ascending: false });
  if (error) throw error;
  const formFields = cfg.fields.map(f => {
    const label = cfg.labels[f];
    if (['description','review','affiliate_disclosure'].includes(f)) return `<label>${esc(label)}<textarea name="${f}" maxlength="2000"></textarea></label>`;
    if (f === 'status') return `<label>${esc(label)}<select name="status"><option>planning</option><option selected>in progress</option><option>completed</option><option>archived</option></select></label>`;
    const type = f === 'url' || f === 'github_url' ? 'url' : f === 'watched_on' ? 'date' : f === 'rating' || f === 'release_year' ? 'number' : 'text';
    const extra = f === 'title' ? 'required maxlength="160"' : f === 'rating' ? 'min="0" max="10" step="0.5"' : f === 'release_year' ? 'min="1880" max="2100"' : '';
    return `<label>${esc(label)}<input name="${f}" type="${type}" ${extra}></label>`;
  }).join('') + `<label>Who can see this?<select name="visibility"><option value="private" selected>Only me</option><option value="public">Public (shown on my profile)</option></select></label>`;
  const rows = data.length ? `<ul class="plain-list">${data.map(item => `<li>${entryBody(item)}<div class="entry-controls"><span class="badge ${item.visibility === 'public' ? 'badge-public' : ''}">${item.visibility === 'public' ? 'Public' : 'Only me'}</span><button class="text-button" type="button" data-toggle-entry-visibility="${item.id}" data-table="${table}" data-current="${item.visibility === 'public' ? 'public' : 'private'}">${item.visibility === 'public' ? 'Make private' : 'Make public'}</button><button class="text-button" data-delete-entry="${item.id}" data-table="${table}">Delete</button></div></li>`).join('')}</ul>` : empty('Nothing here yet.');
  dom.viewContainer.innerHTML = pageHead(cfg.title, 'Add and manage your collection. Entries marked Public appear on your profile.') + `<form id="collection-form" class="content-form"><h3>Add entry</h3>${formFields}<button class="button primary" type="submit">Save entry</button></form>` + section('Your entries', rows);
}
export async function submitCollection(form) {
  const table = ps.currentView;
  const fd = new FormData(form);
  const payload = { user_id: ps.currentUser.id };
  for (const [key, value] of fd.entries()) payload[key] = value === '' ? null : value;
  for (const key of ['rating','release_year']) if (payload[key] != null) payload[key] = Number(payload[key]);
  const { error } = await ps.supabase.from(table).insert(payload);
  if (error) return toast(error.message);
  toast('Entry saved.'); renderCollection(table);
}
export async function submitMedia(form) {
  const fd = new FormData(form);
  const file = fd.get('file');
  if (!file || !file.size) return toast('Choose a file first.');
  if (file.size > 50 * 1024 * 1024) return toast('That file is larger than 50 MB.');
  const kind = ps.currentView === 'images' ? 'image' : ps.currentView === 'videos' ? 'video' : 'audio';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${ps.currentUser.id}/${crypto.randomUUID()}-${safeName}`;
  const upload = await ps.supabase.storage.from('user-media').upload(path, file, { upsert: false });
  if (upload.error) return toast(upload.error.message);
  const { error } = await ps.supabase.from('media_items').insert({ user_id: ps.currentUser.id, media_type: kind, title: fd.get('title'), description: fd.get('description') || '', visibility: 'private', storage_path: path, public_url: null });
  if (error) { await ps.supabase.storage.from('user-media').remove([path]); return toast(error.message); }
  toast('File uploaded to your private library.'); renderMedia(kind);
}
