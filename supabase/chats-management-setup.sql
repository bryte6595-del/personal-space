-- Personal Space: Chats management (message deletion and per-user conversation clearing)
-- Run once in Supabase SQL Editor. Safe to run again.

-- Delete for me: hides one message only for the signed-in user.
create table if not exists public.message_hidden (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.message_hidden enable row level security;
grant select, insert, delete on public.message_hidden to authenticated;
drop policy if exists "Users view their hidden messages" on public.message_hidden;
create policy "Users view their hidden messages" on public.message_hidden
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users hide messages for themselves" on public.message_hidden;
create policy "Users hide messages for themselves" on public.message_hidden
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users unhide their messages" on public.message_hidden;
create policy "Users unhide their messages" on public.message_hidden
  for delete to authenticated using (user_id = auth.uid());

-- Delete conversation: hides messages up to this time for this user only.
-- New messages after cleared_at will make the conversation visible again.
create table if not exists public.conversation_clears (
  user_id uuid not null references public.profiles(id) on delete cascade,
  other_user_id uuid not null references public.profiles(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, other_user_id),
  check (user_id <> other_user_id)
);

alter table public.conversation_clears enable row level security;
grant select, insert, update, delete on public.conversation_clears to authenticated;
drop policy if exists "Users manage their own conversation clears" on public.conversation_clears;
create policy "Users manage their own conversation clears" on public.conversation_clears
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only the sender can permanently delete a message for everyone.
-- Recipients can still hide a message for themselves through message_hidden.
drop policy if exists "Participants delete messages" on public.messages;
drop policy if exists "Senders delete their own messages" on public.messages;
create policy "Senders delete their own messages" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

create index if not exists message_hidden_user_idx on public.message_hidden(user_id);
create index if not exists conversation_clears_user_idx on public.conversation_clears(user_id, other_user_id);
