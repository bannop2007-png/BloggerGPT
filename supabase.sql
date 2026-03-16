create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default 'New chat',
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists profiles_id_idx on profiles(id);
create index if not exists chats_user_id_idx on chats(user_id);
create index if not exists messages_chat_id_idx on messages(chat_id);
create index if not exists messages_user_id_idx on messages(user_id);

alter table profiles enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
  ) then
    create policy "Users can manage own profile" on profiles
      for all using (auth.uid() = id) with check (auth.uid() = id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'chats'
  ) then
    create policy "Users can manage own chats" on chats
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'messages'
  ) then
    create policy "Users can manage own messages" on messages
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
