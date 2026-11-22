-- Personal Space starter schema for Supabase PostgreSQL.
-- Run this in Supabase SQL Editor using a project you control.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'New member',
  bio text not null default '' check (char_length(bio) <= 300),
  avatar_url text,
  cover_url text,
  website text,
  profile_visibility text not null default 'public' check (profile_visibility in ('public','friends')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','blocked')),
  created_at timestamptz not null default now(),
  unique(requester_id, addressee_id),
  check(requester_id <> addressee_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id, followed_id),
  check(follower_id <> followed_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  visibility text not null default 'public' check (visibility in ('public','friends','private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('image','video','audio')),
  title text not null,
  description text not null default '',
  storage_path text,
  public_url text,
  visibility text not null default 'public' check (visibility in ('public','friends','private')),
  created_at timestamptz not null default now(),
  check(storage_path is not null or public_url is not null)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check(sender_id <> recipient_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, description text, url text, github_url text,
  status text default 'in progress' check(status in ('planning','in progress','completed','archived')),
  created_at timestamptz not null default now()
);
create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, release_year integer, rating numeric(3,1) check(rating between 0 and 10), watched_on date, review text,
  created_at timestamptz not null default now()
);
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, description text, url text, category text, affiliate_disclosure text,
  created_at timestamptz not null default now()
);

create or replace function public.is_friend(a uuid, b uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=a and f.addressee_id=b) or (f.requester_id=b and f.addressee_id=a)));
$$;
revoke all on function public.is_friend(uuid,uuid) from public;
grant execute on function public.is_friend(uuid,uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, username, display_name)
  values(new.id,
    lower(coalesce(nullif(new.raw_user_meta_data->>'username',''), 'member_' || substr(new.id::text,1,8))),
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), 'New member'))
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.media_items enable row level security;
alter table public.messages enable row level security;
alter table public.projects enable row level security;
alter table public.movies enable row level security;
alter table public.recommendations enable row level security;

grant select, insert, update, delete on public.profiles, public.friendships, public.follows, public.posts, public.media_items, public.messages, public.projects, public.movies, public.recommendations to authenticated;

create policy "Profiles are visible to signed-in users" on public.profiles for select to authenticated using (profile_visibility='public' or id=auth.uid() or public.is_friend(auth.uid(),id));
create policy "Users create their own profile" on public.profiles for insert to authenticated with check(id=auth.uid());
create policy "Users update their own profile" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());

create policy "Friendships visible to participants" on public.friendships for select to authenticated using(requester_id=auth.uid() or addressee_id=auth.uid());
create policy "Users send friend requests" on public.friendships for insert to authenticated with check(requester_id=auth.uid() and status='pending');
create policy "Recipients accept or decline requests" on public.friendships for update to authenticated using(addressee_id=auth.uid()) with check(addressee_id=auth.uid() and status in ('accepted','declined'));
create policy "Participants remove friendship" on public.friendships for delete to authenticated using(requester_id=auth.uid() or addressee_id=auth.uid());

create policy "Follows visible to participants" on public.follows for select to authenticated using(follower_id=auth.uid() or followed_id=auth.uid());
create policy "Users follow others" on public.follows for insert to authenticated with check(follower_id=auth.uid() and follower_id<>followed_id);
create policy "Users unfollow" on public.follows for delete to authenticated using(follower_id=auth.uid());

create policy "Read permitted posts" on public.posts for select to anon, authenticated using(visibility='public' or user_id=auth.uid() or (visibility='friends' and auth.uid() is not null and public.is_friend(auth.uid(),user_id)));
create policy "Users create own posts" on public.posts for insert to authenticated with check(user_id=auth.uid());
create policy "Users edit own posts" on public.posts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Users delete own posts" on public.posts for delete to authenticated using(user_id=auth.uid());

create policy "Read permitted media" on public.media_items for select to anon, authenticated using(visibility='public' or user_id=auth.uid() or (visibility='friends' and auth.uid() is not null and public.is_friend(auth.uid(),user_id)));
create policy "Users manage own media" on public.media_items for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create policy "Messages visible to participants" on public.messages for select to authenticated using(sender_id=auth.uid() or recipient_id=auth.uid());
create policy "Users send messages to friends" on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.is_friend(sender_id,recipient_id));
create policy "Recipients mark messages read" on public.messages for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
create policy "Participants delete messages" on public.messages for delete to authenticated using(sender_id=auth.uid() or recipient_id=auth.uid());

-- Personal collections are private to their owner in this first version.
create policy "Owners manage projects" on public.projects for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Owners manage movies" on public.movies for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "Owners manage recommendations" on public.recommendations for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Create a private storage bucket named user-media in Supabase Storage.
-- Use the Storage policies below after creating the bucket:
-- insert into storage.buckets(id,name,public) values('user-media','user-media',false) on conflict(id) do nothing;
-- create policy "Users upload to own folder" on storage.objects for insert to authenticated with check(bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);
-- create policy "Users read own media files" on storage.objects for select to authenticated using(bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);
-- create policy "Users delete own media files" on storage.objects for delete to authenticated using(bucket_id='user-media' and (storage.foldername(name))[1]=auth.uid()::text);
