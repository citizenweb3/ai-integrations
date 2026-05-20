create table if not exists telegram_operators (
  telegram_id bigint primary key,
  operator_id uuid not null,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_operators_active_idx
  on telegram_operators (active, added_at);
