// Posts, likes, comments and the Home feed.
import { renderView } from './router.js';
import { PAGE_SIZE, dom, ps } from './state.js';
import { $, empty, esc, loadMoreMarkup, openImageViewer, pageHead, profileLink, section, setBusy, toast } from './utils.js';

export async function buildPostCards(posts, { allowDelete = false } = {}) {
  if (!posts?.length) return empty('No posts to show yet.');
  const postIds = posts.map(p => p.id);
  const userIds = [...new Set(posts.map(p => p.user_id))];
  const [mediaResult, likesResult, commentsResult, profilesResult] = await Promise.all([
    ps.supabase.from('post_media').select('id,post_id,user_id,storage_path,position').in('post_id', postIds).order('position', { ascending: true }),
    ps.supabase.from('post_likes').select('post_id,user_id').in('post_id', postIds),
    ps.supabase.from('post_comments').select('id,post_id,user_id,parent_comment_id,body,created_at').in('post_id', postIds).order('created_at', { ascending: true }),
    ps.supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', userIds)
  ]);
  for (const result of [mediaResult, likesResult, commentsResult, profilesResult]) if (result.error) throw result.error;
  const commentIds = (commentsResult.data || []).map(comment => comment.id);
  let commentLikesResult = { data: [], error: null };
  if (commentIds.length) commentLikesResult = await ps.supabase.from('post_comment_likes').select('comment_id,user_id').in('comment_id', commentIds);
  if (commentLikesResult.error) throw commentLikesResult.error;
  const mediaByPost = {};
  await Promise.all((mediaResult.data || []).map(async item => {
    const signed = await ps.supabase.storage.from('user-media').createSignedUrl(item.storage_path, 3600);
    if (signed.error) throw signed.error;
    (mediaByPost[item.post_id] ||= []).push({ ...item, url: signed.data.signedUrl });
  }));
  const extraIds = [...new Set([...(commentsResult.data || []).map(comment => comment.user_id), ...(likesResult.data || []).map(like => like.user_id)])].filter(id => !userIds.includes(id));
  let extraProfiles = [];
  if (extraIds.length) { const extra = await ps.supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', extraIds); if (extra.error) throw extra.error; extraProfiles = extra.data || []; }
  const profileById = Object.fromEntries([...(profilesResult.data || []), ...extraProfiles].map(person => [person.id, person]));
  const likesByPost = {};
  for (const like of likesResult.data || []) {
    const item = (likesByPost[like.post_id] ||= { count: 0, mine: false });
    item.count++;
    if (like.user_id === ps.currentUser.id) item.mine = true;
  }
  const likersByPost = {};
  for (const like of likesResult.data || []) (likersByPost[like.post_id] ||= []).push(profileById[like.user_id] || { id: like.user_id, display_name: 'Member', username: 'unknown' });
  const commentsByPost = {};
  for (const comment of commentsResult.data || []) (commentsByPost[comment.post_id] ||= []).push(comment);
  const commentLikesById = {};
  for (const like of commentLikesResult.data || []) { const item = (commentLikesById[like.comment_id] ||= { count: 0, mine: false }); item.count++; if (like.user_id === ps.currentUser.id) item.mine = true; }
  const commentMarkup = (comment, all, depth = 0) => {
    const person = profileById[comment.user_id] || { id: comment.user_id, display_name: 'Member', username: 'unknown' };
    const replies = all.filter(x => x.parent_comment_id === comment.id);
    const commentLike = commentLikesById[comment.id] || { count: 0, mine: false };
    return `<div class="post-comment${depth ? ' post-reply' : ''}"><div class="comment-head">${profileLink(person)}<span class="post-meta">${new Date(comment.created_at).toLocaleString()}</span></div><p class="comment-body">${esc(comment.body)}</p><div class="comment-actions"><button class="text-button comment-like-button${commentLike.mine ? ' liked' : ''}" type="button" data-toggle-comment-like="${comment.id}" aria-pressed="${commentLike.mine}">${commentLike.mine ? '♥ Liked' : '♡ Like'} <span data-comment-like-count="${comment.id}">${commentLike.count || ''}</span></button>${depth === 0 ? `<button class="text-button" type="button" data-reply-comment="${comment.id}" data-post-id="${comment.post_id}">Reply</button>` : ''}${comment.user_id === ps.currentUser.id ? `<button class="text-button" type="button" data-edit-comment="${comment.id}">Edit</button><button class="text-button" type="button" data-delete-comment="${comment.id}" data-post-id="${comment.post_id}">Delete</button>` : ''}</div>${comment.user_id === ps.currentUser.id ? `<form class="edit-comment-form" data-edit-comment-form="${comment.id}" hidden><input name="body" maxlength="2000" value="${esc(comment.body)}" required><button class="button" type="submit">Save</button></form>` : ''}<form class="reply-form" data-reply-form="${comment.id}" data-post-id="${comment.post_id}" hidden><input name="body" maxlength="2000" placeholder="Write a reply…" required><button class="button" type="submit">Reply</button></form>${depth === 0 && replies.length ? `<div class="comment-replies">${replies.map(reply => commentMarkup(reply, all, 1)).join('')}</div>` : ''}</div>`;
  };
  return `<div class="post-feed">${posts.map(post => {
    const author = profileById[post.user_id] || { id: post.user_id, display_name: 'Member', username: 'unknown' };
    const media = mediaByPost[post.id] || [];
    const gallery = media.length ? `<div class="post-gallery ${media.length === 1 ? 'single-image' : 'multi-image'}">${media.map((item, index) => `<button type="button" class="post-image-open" data-post-image="${esc(item.url)}" data-post-id="${post.id}" data-image-index="${index}" aria-label="Open image ${index + 1} of ${media.length}"><img src="${esc(item.url)}" alt="Post image ${index + 1}" loading="lazy"></button>`).join('')}</div>` : '';
    const like = likesByPost[post.id] || { count: 0, mine: false };
    const comments = commentsByPost[post.id] || [];
    const roots = comments.filter(c => !c.parent_comment_id);
    return `<article class="post-card" data-post-card="${post.id}"><div class="post-card-head">${profileLink(author)}<div class="post-head-meta"><span class="post-meta">${new Date(post.created_at).toLocaleString()}</span><span class="post-visibility">${esc(post.visibility)}</span></div>${allowDelete && post.user_id === ps.currentUser.id ? `<button type="button" class="text-button" data-delete-post="${post.id}">Delete</button>` : ''}${post.user_id !== ps.currentUser.id ? `<button type="button" class="text-button report-link" data-report-user="${post.user_id}" data-report-post="${post.id}">Report</button>` : ''}</div>${post.body ? `<p class="post-body">${esc(post.body)}</p>` : ''}${gallery}<div class="post-engagement"><button type="button" class="text-button like-button${like.mine ? ' liked' : ''}" data-toggle-like="${post.id}" aria-pressed="${like.mine}">${like.mine ? '♥ Liked' : '♡ Like'}</button><button type="button" class="text-button likes-count" data-show-likes="${post.id}" data-like-count="${like.count}" ${like.count ? '' : 'disabled'}>${like.count} ${like.count === 1 ? 'like' : 'likes'}</button><span class="post-meta">${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}</span></div><div class="post-likers" data-likers="${post.id}" hidden>${(likersByPost[post.id] || []).map(person => profileLink(person)).join('')}</div><div class="post-comments">${roots.map(c => commentMarkup(c, comments)).join('')}<form class="comment-form" data-comment-form="${post.id}"><input name="body" maxlength="2000" placeholder="Write a comment…" required><button class="button" type="submit">Comment</button></form></div></article>`;
  }).join('')}</div>`;
}
export function openPostImage(button) {
  const gallery = button.closest('.post-gallery');
  const images = [...(gallery?.querySelectorAll('[data-post-image]') || [])].map(el => el.dataset.postImage);
  if (images.length) openImageViewer(images, Number(button.dataset.imageIndex) || 0);
}
export async function togglePostLike(postId) {
  const button = $(`[data-toggle-like="${postId}"]`);
  if (!button || button.disabled) return;
  button.disabled = true;
  const existing = await ps.supabase.from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', ps.currentUser.id).maybeSingle();
  if (existing.error) { button.disabled = false; return toast(existing.error.message); }
  const result = existing.data
    ? await ps.supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', ps.currentUser.id)
    : await ps.supabase.from('post_likes').insert({ post_id: postId, user_id: ps.currentUser.id });
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
export async function toggleCommentLike(commentId) {
  const button = $(`[data-toggle-comment-like="${commentId}"]`);
  if (!button || button.disabled) return;
  button.disabled = true;
  const existing = await ps.supabase.from('post_comment_likes').select('comment_id').eq('comment_id', commentId).eq('user_id', ps.currentUser.id).maybeSingle();
  if (existing.error) { button.disabled = false; return toast(existing.error.message); }
  const result = existing.data
    ? await ps.supabase.from('post_comment_likes').delete().eq('comment_id', commentId).eq('user_id', ps.currentUser.id)
    : await ps.supabase.from('post_comment_likes').insert({ comment_id: commentId, user_id: ps.currentUser.id });
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
export async function submitPostComment(form) {
  const postId = form.dataset.commentForm || form.dataset.postId;
  const parentId = form.dataset.parentComment || form.dataset.replyForm || null;
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body) return;
  const { error } = await ps.supabase.from('post_comments').insert({ post_id: postId, user_id: ps.currentUser.id, parent_comment_id: parentId, body });
  if (error) return toast(error.message);
  toast(parentId ? 'Reply added.' : 'Comment added.');
  renderView();
}
export async function submitEditComment(form) {
  const id = form.dataset.editCommentForm;
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body) return;
  const { error } = await ps.supabase.from('post_comments').update({ body, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', ps.currentUser.id);
  if (error) return toast(error.message);
  toast('Comment updated.'); renderView();
}
export async function renderHome() {
  const [friendRows, followRows] = await Promise.all([
    ps.supabase.from('friendships').select('requester_id,addressee_id').eq('status', 'accepted').or(`requester_id.eq.${ps.currentUser.id},addressee_id.eq.${ps.currentUser.id}`),
    ps.supabase.from('follows').select('followed_id').eq('follower_id', ps.currentUser.id)
  ]);
  if (friendRows.error) throw friendRows.error;
  if (followRows.error) throw followRows.error;
  const feedIds = [...new Set([ps.currentUser.id, ...(friendRows.data || []).map(f => f.requester_id === ps.currentUser.id ? f.addressee_id : f.requester_id), ...(followRows.data || []).map(f => f.followed_id)])];
  const { data: posts, error } = await ps.supabase.from('posts').select('id,user_id,body,visibility,created_at').in('user_id', feedIds).order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1);
  if (error) throw error;
  ps.feedContext = { kind: 'home', ids: feedIds, offset: (posts || []).length };
  const cards = (await buildPostCards(posts || [])) + loadMoreMarkup((posts || []).length);
  const shortcuts = [
    ['profile','My profile','Edit your details and profile images','◉'],
    ['friends','Friends','Manage connections and requests','♧'],
    ['messages','Chats','Continue private conversations','✉'],
    ['images','Media library','Browse your uploaded images','▧'],
    ['projects','Projects','Showcase things you are building','⌘'],
    ['movies','Movies','Keep track of what you watch','▣']
  ].map(([view,label,desc,icon]) => `<button type="button" class="home-shortcut" data-view="${view}"><span class="home-shortcut-icon">${icon}</span><span><strong>${label}</strong><small>${desc}</small></span><span class="home-shortcut-arrow">›</span></button>`).join('');
  const composer = `<form id="post-form" class="content-form home-post-form"><label>Post<textarea name="body" maxlength="10000" placeholder="What’s on your mind?"></textarea></label><label>Add images<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><small class="muted">Choose up to 5 images. Each image can be up to 10 MB. You can publish an image without text.</small><div id="post-image-preview" class="post-image-preview"></div><label>Who can see this?<select name="visibility"><option value="public">Public</option><option value="friends">Friends only</option><option value="private">Private</option></select></label><div class="inline-actions"><button class="button primary" type="submit">Publish post</button><button class="button" type="button" data-action="close-home-compose">Cancel</button></div></form>`;
  dom.viewContainer.classList.add('home-view');
  dom.viewContainer.innerHTML = pageHead('Home', `Welcome back, ${ps.currentProfile.display_name}.`, '<button class="button primary" id="home-compose-toggle" data-action="new-post" type="button">＋ Write a post</button>') +
    `<div id="home-compose" class="home-compose" hidden>${composer}</div>` +
    `<details class="home-quick-access home-collapsible"><summary>Quick access <span class="muted">6 shortcuts</span></summary><div class="home-shortcuts">${shortcuts}</div></details>` +
    `<section class="section home-feed-panel"><details class="home-feed-details" open><summary class="section-title">Activity feed <span class="muted">Latest from you, friends and people you follow</span></summary><div class="home-feed-content">${cards}</div></details></section>`;
}
export async function renderPosts() {
  const { data: posts, error } = await ps.supabase.from('posts').select('id,user_id,body,visibility,created_at').eq('user_id', ps.currentUser.id).order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1);
  if (error) throw error;
  ps.feedContext = { kind: 'mine', ids: [ps.currentUser.id], offset: (posts || []).length };
  const cards = (await buildPostCards(posts || [], { allowDelete: true })) + loadMoreMarkup((posts || []).length);
  dom.viewContainer.innerHTML = pageHead('My posts', 'Share words, photographs or both.', '<button class="button primary" data-action="focus-post">New post</button>') +
    `<form id="post-form" class="content-form"><h3>Write something</h3><label>Post<textarea name="body" maxlength="10000" placeholder="What’s on your mind?"></textarea></label><label>Add images<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><small class="muted">Choose up to 5 images. Each image can be up to 10 MB. You can publish an image without text.</small><div id="post-image-preview" class="post-image-preview"></div><label>Who can see this?<select name="visibility"><option value="public">Public</option><option value="friends">Friends only</option><option value="private">Private</option></select></label><button class="button primary" type="submit">Publish post</button></form>` +
    section('Published posts', cards);
}
export async function submitPost(form) {
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
    const inserted = await ps.supabase.from('posts').insert({ user_id: ps.currentUser.id, body: body || null, visibility: fd.get('visibility') }).select('id').single();
    if (inserted.error) throw inserted.error;
    postId = inserted.data.id;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[file.type];
      const path = `${ps.currentUser.id}/posts/${postId}/${crypto.randomUUID()}.${extension}`;
      const upload = await ps.supabase.storage.from('user-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
      if (upload.error) throw upload.error;
      uploaded.push(path);
      const saved = await ps.supabase.from('post_media').insert({ post_id: postId, user_id: ps.currentUser.id, storage_path: path, mime_type: file.type, file_size: file.size, position: index });
      if (saved.error) throw saved.error;
    }
    toast('Post published.');
    if (ps.currentView === 'home') await renderHome(); else await renderPosts();
  } catch (error) {
    if (uploaded.length) await ps.supabase.storage.from('user-media').remove(uploaded);
    if (postId) await ps.supabase.from('posts').delete().eq('id', postId).eq('user_id', ps.currentUser.id);
    throw error;
  } finally { setBusy(form, false); }
}
