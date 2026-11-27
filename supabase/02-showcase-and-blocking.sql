-- Personal Space: public showcase, blocking and reports
-- Run ONCE in Supabase SQL Editor, AFTER 01-security-fixes.sql. Safe to run again.

------------------------------------------------------------------
-- A. Public showcase: projects, movies and recommendations can be made public
------------------------------------------------------------------
alter table public.projects        add column if not exists visibility text not null default 'private';
alter table public.movies          add column if not exists visibility text not null default 'private';
alter table public.recommendations add column if not exists visibility text not null default 'private';

alter table public.projects        drop constraint if exists projects_visibility_check;
alter table public.movies          drop constraint if exists movies_visibility_check;
alter table public.recommendations drop constraint if exists recommendations_visibility_check;
alter table public.projects        add constraint projects_visibility_check        check (visibility in ('public','private'));
alter table public.movies          add constraint movies_visibility_check          check (visibility in ('public','private'));
alter table public.recommendations add constraint recommendations_visibility_check check (visibility in ('public','private'));

------------------------------------------------------------------
-- B. Blocking and reports
------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
grant select, insert, delete on public.blocks to authenticated;

drop policy if exists "Read own blocks" on public.blocks;
create policy "Read own blocks" on public.blocks for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "Create own blocks" on public.blocks;
create policy "Create own blocks" on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists "Remove own blocks" on public.blocks;
create policy "Remove own blocks" on public.blocks for delete to authenticated using (blocker_id = auth.uid());

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_user_id)
);
alter table public.reports enable row level security;
grant select, insert on public.reports to authenticated;
-- Members can file reports and see their own. Only you (project owner, in the dashboard) read all.
drop policy if exists "File own reports" on public.reports;
create policy "File own reports" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "Read own reports" on public.reports;
create policy "Read own reports" on public.reports for select to authenticated using (reporter_id = auth.uid());

-- Helper: has the OTHER person blocked ME?
create or replace function public.blocked_by(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks b where b.blocker_id = other and b.blocked_id = auth.uid());
$$;
-- Helper: is there a block between a and b in either direction?
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks x
    where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a));
$$;
revoke all on function public.blocked_by(uuid) from public, anon;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.blocked_by(uuid) to authenticated;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- Block someone: records the block and removes any friendship / follows between you.
create or replace function public.block_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if target is null or target = auth.uid() then raise exception 'You cannot block yourself.'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), target) on conflict do nothing;
  delete from public.friendships
    where (requester_id = auth.uid() and addressee_id = target) or (requester_id = target and addressee_id = auth.uid());
  delete from public.follows
    where (follower_id = auth.uid() and followed_id = target) or (follower_id = target and followed_id = auth.uid());
end;
$$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

------------------------------------------------------------------
-- C. Policies that use the above
------------------------------------------------------------------
-- Profiles: hidden from anyone who has been blocked by that person.
drop policy if exists "Profiles are visible to signed-in users" on public.profiles;
create policy "Profiles are visible to signed-in users" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or ((profile_visibility = 'public' or public.is_friend(auth.uid(), id)) and not public.blocked_by(id))
);

-- Posts: replaces the policy from 01-security-fixes.sql (adds the blocking rule).
-- Likes, comments, post images and storage already follow this policy.
drop policy if exists "Read permitted posts" on public.posts;
create policy "Read permitted posts" on public.posts for select to authenticated
using (
  user_id = auth.uid()
  or (
    not public.blocked_by(user_id)
    and (
      (visibility in ('public','friends') and public.is_friend(auth.uid(), user_id))
      or (visibility = 'public' and exists (
            select 1 from public.profiles pr
            where pr.id = posts.user_id and pr.profile_visibility = 'public'))
    )
  )
);

-- Public projects / movies / recommendations (owners keep full access through the existing "Owners manage" policies).
drop policy if exists "Read public projects" on public.projects;
create policy "Read public projects" on public.projects for select to authenticated
using (visibility = 'public' and not public.blocked_by(user_id)
  and (public.is_friend(auth.uid(), user_id)
       or exists (select 1 from public.profiles pr where pr.id = projects.user_id and pr.profile_visibility = 'public')));

drop policy if exists "Read public movies" on public.movies;
create policy "Read public movies" on public.movies for select to authenticated
using (visibility = 'public' and not public.blocked_by(user_id)
  and (public.is_friend(auth.uid(), user_id)
       or exists (select 1 from public.profiles pr where pr.id = movies.user_id and pr.profile_visibility = 'public')));

drop policy if exists "Read public recommendations" on public.recommendations;
create policy "Read public recommendations" on public.recommendations for select to authenticated
using (visibility = 'public' and not public.blocked_by(user_id)
  and (public.is_friend(auth.uid(), user_id)
       or exists (select 1 from public.profiles pr where pr.id = recommendations.user_id and pr.profile_visibility = 'public')));

-- No friend requests, follows or messages between blocked people.
drop policy if exists "Users send friend requests" on public.friendships;
create policy "Users send friend requests" on public.friendships for insert to authenticated
with check (requester_id = auth.uid() and status = 'pending' and not public.is_blocked(requester_id, addressee_id));

drop policy if exists "Users follow others" on public.follows;
create policy "Users follow others" on public.follows for insert to authenticated
with check (follower_id = auth.uid() and follower_id <> followed_id and not public.is_blocked(follower_id, followed_id));

drop policy if exists "Users send messages to friends" on public.messages;
create policy "Users send messages to friends" on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_friend(sender_id, recipient_id)
  and not public.is_blocked(sender_id, recipient_id)
  and (media_path is null or (storage.foldername(media_path))[1] = auth.uid()::text)
);
