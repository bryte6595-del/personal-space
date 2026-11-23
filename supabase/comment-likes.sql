-- Personal Space: likes on individual comments
-- Run once in Supabase SQL Editor. Safe to run again.

create table if not exists public.post_comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists post_comment_likes_comment_idx
  on public.post_comment_likes(comment_id);

alter table public.post_comment_likes enable row level security;
grant select, insert, delete on public.post_comment_likes to authenticated;

drop policy if exists "Read likes on visible comments" on public.post_comment_likes;
create policy "Read likes on visible comments"
on public.post_comment_likes for select to authenticated
using (exists (
  select 1
  from public.post_comments c
  join public.posts p on p.id = c.post_id
  where c.id = post_comment_likes.comment_id
    and (p.visibility = 'public' or p.user_id = auth.uid()
      or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));

drop policy if exists "Members like visible comments" on public.post_comment_likes;
create policy "Members like visible comments"
on public.post_comment_likes for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1
  from public.post_comments c
  join public.posts p on p.id = c.post_id
  where c.id = post_comment_likes.comment_id
    and (p.visibility = 'public' or p.user_id = auth.uid()
      or (p.visibility = 'friends' and public.is_friend(auth.uid(), p.user_id)))
));

drop policy if exists "Members remove own comment likes" on public.post_comment_likes;
create policy "Members remove own comment likes"
on public.post_comment_likes for delete to authenticated
using (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.post_comment_likes;
exception when duplicate_object then null; when undefined_object then null; end $$;
