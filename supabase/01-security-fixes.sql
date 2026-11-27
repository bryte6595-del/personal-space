-- Personal Space: security and privacy fixes
-- Run ONCE in Supabase SQL Editor. Safe to run again.

-- 1. Recipients may only mark messages as read. They can no longer edit message text.
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

-- 2. Friend-request recipients may only change the request status.
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- 3. A chat attachment path must live in the sender's own folder.
--    (Stops someone pointing a message at another person's private image.)
drop policy if exists "Users send messages to friends" on public.messages;
create policy "Users send messages to friends" on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_friend(sender_id, recipient_id)
  and (media_path is null or (storage.foldername(media_path))[1] = auth.uid()::text)
);

-- 4. Respect profile privacy.
--    Public posts are now visible to everyone only when the author's profile is public.
--    Friends can still see 'public' and 'friends' posts; the author always sees their own.
--    Likes, comments, post images and storage policies already check this table,
--    so they follow the same rule automatically.
drop policy if exists "Read permitted posts" on public.posts;
create policy "Read permitted posts" on public.posts for select to authenticated
using (
  user_id = auth.uid()
  or (visibility in ('public','friends') and public.is_friend(auth.uid(), user_id))
  or (visibility = 'public' and exists (
        select 1 from public.profiles pr
        where pr.id = posts.user_id and pr.profile_visibility = 'public'))
);

-- 5. Links saved in Projects / Recommendations must be http(s) links.
--    NOT VALID keeps any old rows untouched; new and edited rows are checked.
alter table public.projects drop constraint if exists projects_url_http;
alter table public.projects add constraint projects_url_http
  check (url is null or url ~* '^https?://') not valid;
alter table public.projects drop constraint if exists projects_github_url_http;
alter table public.projects add constraint projects_github_url_http
  check (github_url is null or github_url ~* '^https?://') not valid;
alter table public.recommendations drop constraint if exists recommendations_url_http;
alter table public.recommendations add constraint recommendations_url_http
  check (url is null or url ~* '^https?://') not valid;
alter table public.media_items drop constraint if exists media_items_public_url_http;
alter table public.media_items add constraint media_items_public_url_http
  check (public_url is null or public_url ~* '^https?://') not valid;
