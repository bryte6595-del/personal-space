-- Personal Space: image posts, likes and comments
-- Run once in Supabase SQL Editor. Safe to run again if partially applied.

-- Allow image-only posts while preserving the existing text length limit.
alter table public.posts alter column body drop not null;
alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts add constraint posts_body_check
  check (body is null or char_length(body) <= 10000);

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.post_comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists post_media_post_position_idx on public.post_media(post_id, position);
create index if not exists post_likes_post_idx on public.post_likes(post_id);
create index if not exists post_comments_post_created_idx on public.post_comments(post_id, created_at);

alter table public.post_media enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;

grant select, insert, delete on public.post_media to authenticated;
grant select, insert, delete on public.post_likes to authenticated;
grant select, insert, update, delete on public.post_comments to authenticated;

-- SECURITY DEFINER helper avoids recursive row-security checks when validating a reply parent.
create or replace function public.post_comment_parent_matches(parent_id uuid, target_post_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.post_comments parent
    where parent.id = parent_id and parent.post_id = target_post_id
      and parent.parent_comment_id is null
  );
$$;
revoke all on function public.post_comment_parent_matches(uuid,uuid) from public;
grant execute on function public.post_comment_parent_matches(uuid,uuid) to authenticated;

-- A member can see attachment records only when the parent post is visible to them.
drop policy if exists "Read visible post media records" on public.post_media;
create policy "Read visible post media records" on public.post_media for select to authenticated
using (exists (
  select 1 from public.posts p where p.id = post_media.post_id
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));
drop policy if exists "Owners add post media records" on public.post_media;
create policy "Owners add post media records" on public.post_media for insert to authenticated
with check (user_id = auth.uid() and (storage.foldername(storage_path))[1] = auth.uid()::text and exists (
  select 1 from public.posts p where p.id = post_media.post_id and p.user_id = auth.uid()
));
drop policy if exists "Owners delete post media records" on public.post_media;
create policy "Owners delete post media records" on public.post_media for delete to authenticated
using (user_id = auth.uid());

-- Likes are readable only for visible posts; each member can create/remove only their own like.
drop policy if exists "Read likes on visible posts" on public.post_likes;
create policy "Read likes on visible posts" on public.post_likes for select to authenticated
using (exists (
  select 1 from public.posts p where p.id = post_likes.post_id
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));
drop policy if exists "Members like visible posts" on public.post_likes;
create policy "Members like visible posts" on public.post_likes for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1 from public.posts p where p.id = post_likes.post_id
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));
drop policy if exists "Members remove own likes" on public.post_likes;
create policy "Members remove own likes" on public.post_likes for delete to authenticated
using (user_id = auth.uid());

-- Comments and replies inherit the parent post's visibility.
drop policy if exists "Read comments on visible posts" on public.post_comments;
create policy "Read comments on visible posts" on public.post_comments for select to authenticated
using (exists (
  select 1 from public.posts p where p.id = post_comments.post_id
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));
drop policy if exists "Members comment on visible posts" on public.post_comments;
create policy "Members comment on visible posts" on public.post_comments for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1 from public.posts p where p.id = post_comments.post_id
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
) and (parent_comment_id is null or public.post_comment_parent_matches(parent_comment_id, post_comments.post_id)));
drop policy if exists "Members edit own comments" on public.post_comments;
create policy "Members edit own comments" on public.post_comments for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (
  select 1 from public.posts p where p.id = post_comments.post_id
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
) and (parent_comment_id is null or public.post_comment_parent_matches(parent_comment_id, post_comments.post_id)));
drop policy if exists "Members delete own comments" on public.post_comments;
create policy "Members delete own comments" on public.post_comments for delete to authenticated
using (user_id = auth.uid());

-- Keep the user-media bucket private. Permit reading an image only when its post is visible.
-- Existing owner-only media policies remain in place and are combined with this policy by Postgres.
drop policy if exists "Read images attached to visible posts" on storage.objects;
create policy "Read images attached to visible posts" on storage.objects for select to authenticated
using (bucket_id = 'user-media' and exists (
  select 1 from public.post_media pm
  join public.posts p on p.id = pm.post_id
  where pm.storage_path = storage.objects.name
  and (p.visibility = 'public' or p.user_id = auth.uid()
    or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));

-- Allow the app's realtime feed to refresh when social interactions change.
do $$ begin
  alter publication supabase_realtime add table public.post_media;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.post_likes;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.post_comments;
exception when duplicate_object then null; when undefined_object then null; end $$;
