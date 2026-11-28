-- Personal Space: save your appearance choice (mode + accent color) to your account
-- Run ONCE in Supabase SQL Editor, after 01 and 02. Safe to run again.
-- The site works without this (the choice is then remembered on each device only).

alter table public.profiles add column if not exists ui_mode text;
alter table public.profiles add column if not exists ui_accent text;

alter table public.profiles drop constraint if exists profiles_ui_mode_check;
alter table public.profiles add constraint profiles_ui_mode_check
  check (ui_mode is null or ui_mode in ('light','dark','auto'));

alter table public.profiles drop constraint if exists profiles_ui_accent_check;
alter table public.profiles add constraint profiles_ui_accent_check
  check (ui_accent is null or ui_accent in ('teal','blue','purple','green','warm','rose'));
