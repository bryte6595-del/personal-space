-- Enable live database change events for Personal Space.
-- Run this once in Supabase SQL Editor.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'profiles', 'posts', 'friendships', 'follows', 'messages',
    'media_items', 'projects', 'movies', 'recommendations'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
