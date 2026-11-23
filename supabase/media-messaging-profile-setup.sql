-- Personal Space: private chat image attachments + profile picture/banner storage
-- Run once in Supabase SQL Editor. Safe to run again if partially applied.

-- Chat attachments are linked to the existing messages table.
alter table public.messages
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists media_name text,
  add column if not exists media_size bigint;

-- Allow image-only messages while preserving the 5,000-character text limit.
alter table public.messages alter column body set default '';
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (char_length(body) between 0 and 5000 and (char_length(body) > 0 or media_path is not null));

create index if not exists messages_media_path_idx on public.messages(media_path) where media_path is not null;

-- Private bucket: only the sender and recipient of a message can read its attachment.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-media', 'message-media', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Message participants view chat images" on storage.objects;
create policy "Message participants view chat images"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and exists (
    select 1 from public.messages m
    where m.media_path = storage.objects.name
      and auth.uid() in (m.sender_id, m.recipient_id)
  )
);

drop policy if exists "Users upload own chat images" on storage.objects;
create policy "Users upload own chat images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own chat images" on storage.objects;
create policy "Users delete own chat images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Profile pictures and banners are intentionally public profile assets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Public can view profile media" on storage.objects;
create policy "Public can view profile media"
on storage.objects for select to public
using (bucket_id = 'profile-media');

drop policy if exists "Users upload own profile media" on storage.objects;
create policy "Users upload own profile media"
on storage.objects for insert to authenticated
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update own profile media" on storage.objects;
create policy "Users update own profile media"
on storage.objects for update to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own profile media" on storage.objects;
create policy "Users delete own profile media"
on storage.objects for delete to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
