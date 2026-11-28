// All clicks, typing and form submits are handled here, then passed to the right feature.
import { handleAuth } from './auth.js';
import { openChat, submitMessage } from './chats.js';
import { renderCollection, submitCollection, submitMedia } from './collections.js';
import { acceptFriend, searchUser, sendFriendRequest } from './friends.js';
import { buildPostCards, openPostImage, renderHome, submitEditComment, submitPost, submitPostComment, toggleCommentLike, togglePostLike } from './posts.js';
import { openProfileCropper, submitProfile, submitProfileImage } from './profile.js';
import { loadNotificationPanel, setPostSeenAt, stopRealtime } from './realtime.js';
import { go, renderView } from './router.js';
import { viewFromLocation } from './routes.js';
import { closeMobileSidebar, setAuthMessage, setAuthTab, showAuth, toggleMobileSidebar } from './shell.js';
import { PAGE_SIZE, dom, ps, titles } from './state.js';
import { setAccent, setMode, toggleMode } from './theme.js';
import { $, $$, errorText, esc, openImageViewer, toast } from './utils.js';

export function bindEvents() {
  window.addEventListener('popstate', () => {
    ps.currentView = viewFromLocation(titles);
    const params = new URLSearchParams(location.search);
    ps.viewedProfileId = params.get('member');
    ps.activeChatUser = params.get('chat');
    $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === ps.currentView));
    $('#breadcrumb').textContent = titles[ps.currentView];
    closeMobileSidebar();
    renderView();
  });
  document.addEventListener('click', async event => {
    if (event.target.closest('#notification-button')) {
      ps.notificationPanelOpen = !ps.notificationPanelOpen;
      const panel = $('#notification-panel');
      panel.hidden = !ps.notificationPanelOpen;
      $('#notification-button').setAttribute('aria-expanded', String(ps.notificationPanelOpen));
      if (ps.notificationPanelOpen) await loadNotificationPanel();
      return;
    }
    if (event.target.closest('#notification-close')) { ps.notificationPanelOpen = false; $('#notification-panel').hidden = true; $('#notification-button').setAttribute('aria-expanded','false'); return; }
    const notificationChat = event.target.closest('[data-notification-chat]');
    if (notificationChat) { $('#notification-panel').hidden = true; ps.notificationPanelOpen = false; go('messages', { chat: notificationChat.dataset.notificationChat }); return; }
    if (event.target.closest('[data-notification-friends]')) { $('#notification-panel').hidden = true; ps.notificationPanelOpen = false; go('friends'); return; }
    const notificationPost = event.target.closest('[data-notification-post]');
    if (notificationPost) { setPostSeenAt(notificationPost.dataset.postCreated || new Date().toISOString()); $('#notification-panel').hidden = true; ps.notificationPanelOpen = false; ps.viewedProfileId = notificationPost.dataset.notificationPost; go('public-profile'); return; }
    if (ps.notificationPanelOpen && !event.target.closest('.notification-wrap')) { ps.notificationPanelOpen = false; $('#notification-panel').hidden = true; $('#notification-button')?.setAttribute('aria-expanded','false'); }
    const nav = event.target.closest('[data-view]');
    if (nav) { event.preventDefault(); go(nav.dataset.view); return; }
    const tab = event.target.closest('[data-auth-tab]'); if (tab) { setAuthTab(tab.dataset.authTab); return; }
    if (event.target.closest('#collapse-sidebar')) { $('#sidebar').classList.toggle('collapsed'); return; }
    if (event.target.closest('#mobile-menu')) { toggleMobileSidebar(); return; }
    if (event.target.closest('#close-mobile-sidebar') || event.target.closest('#sidebar-backdrop')) { closeMobileSidebar(); return; }
    if (event.target.closest('#theme-toggle')) { toggleMode(); return; }
  const modeButton = event.target.closest('[data-set-mode]');
  if (modeButton) { setMode(modeButton.dataset.setMode); return; }
  const accentButton = event.target.closest('[data-set-accent]');
  if (accentButton) { setAccent(accentButton.dataset.setAccent); return; }
    if (event.target.closest('#logout-button')) { stopRealtime(); await ps.supabase.auth.signOut(); ps.currentUser = null; ps.currentProfile = null; showAuth(); return; }
    if (event.target.closest('[data-action="retry"]')) { renderView(); return; }
    if (event.target.closest('[data-load-new-posts]')) { await renderHome(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (event.target.closest('[data-chat-back]')) { dom.viewContainer.classList.remove('has-active-chat'); ps.activeChatUser = null; history.replaceState({ view:'messages' }, '', 'chats.html'); return; }
    if (event.target.closest('[data-toggle-emoji]')) { const picker = $('#message-emoji-picker'); if (picker) picker.hidden = !picker.hidden; return; }
    const insertEmoji = event.target.closest('[data-insert-emoji]'); if (insertEmoji) { const input = $('#message-form textarea[name=body]'); if (input && !input.disabled) { const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? input.value.length; input.value = input.value.slice(0,start) + insertEmoji.dataset.insertEmoji + input.value.slice(end); input.focus(); const pos = start + insertEmoji.dataset.insertEmoji.length; input.setSelectionRange(pos,pos); } const picker = $('#message-emoji-picker'); if (picker) picker.hidden = true; return; }
    const newPostAction = event.target.closest('[data-action="new-post"]');
    if (newPostAction) {
      if (ps.currentView === 'home') {
        const composer = $('#home-compose');
        if (composer) {
          composer.hidden = !composer.hidden;
          const toggle = $('#home-compose-toggle');
          if (toggle) toggle.textContent = composer.hidden ? '＋ Write a post' : 'Close composer';
          if (!composer.hidden) $('#post-form textarea')?.focus();
        }
      } else if (ps.currentView !== 'posts') go('posts');
      else $('#post-form textarea')?.focus();
      return;
    }
    if (event.target.closest('[data-action="focus-post"]')) { if (ps.currentView !== 'posts') go('posts'); else $('#post-form textarea')?.focus(); return; }
    if (event.target.closest('[data-action="close-home-compose"]')) { const composer = $('#home-compose'); if (composer) composer.hidden = true; const toggle = $('#home-compose-toggle'); if (toggle) toggle.textContent = '＋ Write a post'; return; }
    const delPost = event.target.closest('[data-delete-post]'); if (delPost) { if (!confirm('Delete this post?')) return; const postId = delPost.dataset.deletePost; const media = await ps.supabase.from('post_media').select('storage_path').eq('post_id', postId); if (media.error) return toast(media.error.message); const paths = (media.data || []).map(x => x.storage_path); const removed = await ps.supabase.from('posts').delete().eq('id', postId).eq('user_id', ps.currentUser.id); if (removed.error) return toast(removed.error.message); if (paths.length) await ps.supabase.storage.from('user-media').remove(paths); toast('Post deleted.'); renderView(); return; }
    const imageButton = event.target.closest('[data-post-image]'); if (imageButton) { openPostImage(imageButton); return; }
    const chatImage = event.target.closest('[data-chat-image]'); if (chatImage) { openImageViewer([chatImage.dataset.chatImage]); return; }
    if (event.target.closest('[data-remove-message-image]')) { const input = $('#message-form input[name="image"]'); if (input) input.value = ''; if (ps.messagePreviewUrl) URL.revokeObjectURL(ps.messagePreviewUrl); ps.messagePreviewUrl = null; const preview = $('#message-image-preview'); if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; }
    const likeButton = event.target.closest('[data-toggle-like]'); if (likeButton) { await togglePostLike(likeButton.dataset.toggleLike); return; }
    const commentLike = event.target.closest('[data-toggle-comment-like]'); if (commentLike) { await toggleCommentLike(commentLike.dataset.toggleCommentLike); return; }
    const likesButton = event.target.closest('[data-show-likes]'); if (likesButton) { const list = $(`[data-likers="${likesButton.dataset.showLikes}"]`); if (list) list.hidden = !list.hidden; return; }
    const editComment = event.target.closest('[data-edit-comment]'); if (editComment) { const form = $(`[data-edit-comment-form="${editComment.dataset.editComment}"]`); if (form) { form.hidden = !form.hidden; if (!form.hidden) { const input = form.querySelector('input'); input.focus(); input.setSelectionRange(input.value.length,input.value.length); } } return; }
    const replyButton = event.target.closest('[data-reply-comment]'); if (replyButton) { const form = $(`[data-reply-form="${replyButton.dataset.replyComment}"]`); if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input')?.focus(); } return; }
    const deleteComment = event.target.closest('[data-delete-comment]'); if (deleteComment) { if (!confirm('Delete this comment?')) return; const { error } = await ps.supabase.from('post_comments').delete().eq('id', deleteComment.dataset.deleteComment).eq('user_id', ps.currentUser.id); if (error) toast(error.message); else { toast('Comment deleted.'); renderView(); } return; }
    const loadMore = event.target.closest('[data-load-more-posts]');
    if (loadMore && ps.feedContext) {
      loadMore.disabled = true; loadMore.textContent = 'Loading…';
      try {
        const { data: more, error } = await ps.supabase.from('posts').select('id,user_id,body,visibility,created_at').in('user_id', ps.feedContext.ids).order('created_at', { ascending: false }).range(ps.feedContext.offset, ps.feedContext.offset + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = more || [];
        if (rows.length) loadMore.parentElement.insertAdjacentHTML('beforebegin', await buildPostCards(rows, { allowDelete: ps.feedContext.kind === 'mine' }));
        ps.feedContext.offset += rows.length;
        if (rows.length < PAGE_SIZE) loadMore.parentElement.remove(); else { loadMore.disabled = false; loadMore.textContent = 'Load more posts'; }
      } catch (error) { toast(errorText(error)); loadMore.disabled = false; loadMore.textContent = 'Load more posts'; }
      return;
    }
    const toggleVisibility = event.target.closest('[data-toggle-entry-visibility]');
    if (toggleVisibility) {
      const next = toggleVisibility.dataset.current === 'public' ? 'private' : 'public';
      const { error } = await ps.supabase.from(toggleVisibility.dataset.table).update({ visibility: next }).eq('id', toggleVisibility.dataset.toggleEntryVisibility).eq('user_id', ps.currentUser.id);
      toast(error ? errorText(error) : next === 'public' ? 'Now public on your profile.' : 'Now visible only to you.');
      if (!error) renderCollection(toggleVisibility.dataset.table);
      return;
    }
    const blockButton = event.target.closest('[data-block-user]');
    if (blockButton) {
      if (!confirm('Block this person? You will be unfriended and stop following each other. They will no longer see your profile or posts, and neither of you can message the other.')) return;
      const { error } = await ps.supabase.rpc('block_user', { target: blockButton.dataset.blockUser });
      toast(error ? errorText(error) : 'Person blocked.');
      if (!error) renderView();
      return;
    }
    const unblockButton = event.target.closest('[data-unblock-user]');
    if (unblockButton) {
      const { error } = await ps.supabase.from('blocks').delete().eq('blocker_id', ps.currentUser.id).eq('blocked_id', unblockButton.dataset.unblockUser);
      toast(error ? errorText(error) : 'Person unblocked.');
      if (!error) renderView();
      return;
    }
    const reportButton = event.target.closest('[data-report-user]');
    if (reportButton) {
      const reason = (window.prompt('Briefly tell us what is wrong (max 500 characters):') || '').trim();
      if (!reason) return;
      const { error } = await ps.supabase.from('reports').insert({ reporter_id: ps.currentUser.id, reported_user_id: reportButton.dataset.reportUser, post_id: reportButton.dataset.reportPost || null, reason: reason.slice(0, 500) });
      toast(error ? errorText(error) : 'Thank you. Your report was sent.');
      return;
    }
    const openProfile = event.target.closest('[data-open-profile]'); if (openProfile) { ps.viewedProfileId = openProfile.dataset.openProfile; go('public-profile'); return; }
    const add = event.target.closest('[data-add-friend]'); if (add) { await sendFriendRequest(add.dataset.addFriend); return; }
    const accept = event.target.closest('[data-accept-friend]'); if (accept) { await acceptFriend(accept.dataset.acceptFriend); return; }
    const follow = event.target.closest('[data-toggle-follow]'); if (follow) { const targetId = follow.dataset.toggleFollow; follow.disabled = true; const existing = await ps.supabase.from('follows').select('follower_id').eq('follower_id', ps.currentUser.id).eq('followed_id', targetId).maybeSingle(); if (existing.error) { follow.disabled = false; return toast(existing.error.message); } const result = existing.data ? await ps.supabase.from('follows').delete().eq('follower_id', ps.currentUser.id).eq('followed_id', targetId) : await ps.supabase.from('follows').insert({ follower_id: ps.currentUser.id, followed_id: targetId }); if (result.error) { follow.disabled = false; return toast(result.error.message); } follow.textContent = existing.data ? 'Follow' : 'Unfollow'; follow.disabled = false; toast(existing.data ? 'You unfollowed this person.' : 'You are now following this person.'); return; }
    const messageUser = event.target.closest('[data-message-user]'); if (messageUser) { const targetId = messageUser.dataset.messageUser; go('messages', { chat: targetId }); return; }
    const friendTab = event.target.closest('[data-friend-tab]'); if (friendTab) { $$('[data-friend-tab]').forEach(b => b.classList.toggle('active', b === friendTab)); $$('[data-friend-section]').forEach(panel => { panel.hidden = panel.dataset.friendSection !== friendTab.dataset.friendTab; }); return; }
    const decline = event.target.closest('[data-decline-friend], [data-cancel-friend]'); if (decline) { const id = decline.dataset.declineFriend || decline.dataset.cancelFriend; if (!confirm(decline.hasAttribute('data-decline-friend') ? 'Decline this friend request?' : 'Cancel this sent request?')) return; const { error } = await ps.supabase.from('friendships').delete().eq('id', id); toast(error ? error.message : 'Request removed.'); if (!error) renderView(); return; }
    const chat = event.target.closest('[data-chat-user]'); if (chat) { await openChat(chat.dataset.chatUser); return; }
    const delMedia = event.target.closest('[data-delete-media]'); if (delMedia) { if (!confirm('Delete this media item?')) return; const path = delMedia.dataset.storagePath; if (path) { const r = await ps.supabase.storage.from('user-media').remove([path]); if (r.error) return toast(r.error.message); } const r = await ps.supabase.from('media_items').delete().eq('id', delMedia.dataset.deleteMedia).eq('user_id', ps.currentUser.id); toast(r.error ? r.error.message : 'Media deleted.'); if (!r.error) renderView(); return; }
    const delEntry = event.target.closest('[data-delete-entry]'); if (delEntry) { if (!confirm('Delete this entry?')) return; const { error } = await ps.supabase.from(delEntry.dataset.table).delete().eq('id', delEntry.dataset.deleteEntry).eq('user_id', ps.currentUser.id); toast(error ? error.message : 'Entry deleted.'); if (!error) renderCollection(delEntry.dataset.table); return; }
    if (event.target.closest('#reset-password')) { const { error } = await ps.supabase.auth.resetPasswordForEmail(ps.currentUser.email, { redirectTo: window.location.origin }); toast(error ? error.message : 'Password reset email requested.'); }
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
    else if (input.matches('#message-form input[name="image"]')) { const file = input.files?.[0]; const preview = $('#message-image-preview'); if (ps.messagePreviewUrl) URL.revokeObjectURL(ps.messagePreviewUrl); ps.messagePreviewUrl = null; if (!file) { if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; } if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) { toast('Choose a JPG, PNG, WEBP or GIF image up to 10 MB.'); input.value = ''; if (preview) { preview.hidden = true; preview.innerHTML = ''; } return; } ps.messagePreviewUrl = URL.createObjectURL(file); if (preview) { preview.innerHTML = `<img src="${ps.messagePreviewUrl}" alt="Image preview"><span>${esc(file.name)}</span><button type="button" class="text-button" data-remove-message-image>Remove</button>`; preview.hidden = false; } }
    else if (input.matches('#avatar-upload-form input[type=file]')) openProfileCropper(input, 'avatar_url');
    else if (input.matches('#cover-upload-form input[type=file]')) openProfileCropper(input, 'cover_url');
  });
  document.addEventListener('keydown', event => {
    const composer = event.target.closest('#message-form textarea[name="body"]');
    if (!composer) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      composer.form?.requestSubmit();
    }
    // Plain Enter is intentionally left to the textarea so it inserts a new line.
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
    const { error } = await ps.supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setAuthMessage(error ? error.message : 'Password reset email requested. Check your inbox.');
  });
}
