-- Personal Space: public profile picture and banner storage
-- Run once in Supabase SQL Editor. This creates a separate bucket so private user-media stays private.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- Anyone may view profile pictures and banners because profiles can be public.
drop policy if exists "Public can view profile media" on storage.objects;
create policy "Public can view profile media"
on storage.objects for select
to public
using (bucket_id = 'profile-media');

-- Signed-in users may upload only into their own folder.
drop policy if exists "Users upload own profile media" on storage.objects;
create policy "Users upload own profile media"
on storage.objects for insert
to authenticated
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Users may replace or remove only files in their own folder.
drop policy if exists "Users update own profile media" on storage.objects;
create policy "Users update own profile media"
on storage.objects for update
to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own profile media" on storage.objects;
create policy "Users delete own profile media"
on storage.objects for delete
to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
