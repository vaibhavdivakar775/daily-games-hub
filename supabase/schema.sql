-- DailyHub database (Supabase / Postgres). Safe to re-run.

create table if not exists public.scores (
  grp      text   not null,                 -- leaderboard group, e.g. 'squad'
  name_key text   not null,                 -- lower-case username, so "Riya" and "riya" are one person
  name     text   not null,                 -- username as typed
  date     date   not null,                 -- the player's local date
  game     text   not null,
  value    double precision not null,       -- raw score used for ranking
  label    text   not null,                 -- human score, e.g. "3/6"
  puzzle   text   not null default '',
  ts       bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (grp, name_key, date, game)
);
create index if not exists scores_grp_date on public.scores (grp, date);

-- Anyone with the site can read and post scores (like before), but only sensible ones.
alter table public.scores enable row level security;
grant select, insert, update, delete on public.scores to anon;

create or replace function public.valid_score(s public.scores) returns boolean
language sql immutable as $$
  select char_length(s.name) between 1 and 20
     and s.name_key = lower(s.name)
     and char_length(s.grp) between 1 and 30
     and s.game in ('maptap','krillion','cryptic','wordle','connections','globle','farflung','perceptle')
     and char_length(s.label) <= 60 and char_length(s.puzzle) <= 60
     and s.date between current_date - 2 and current_date + 1
$$;

drop policy if exists scores_read   on public.scores;
drop policy if exists scores_insert on public.scores;
drop policy if exists scores_update on public.scores;
drop policy if exists scores_delete on public.scores;
create policy scores_read   on public.scores for select to anon using (true);
create policy scores_insert on public.scores for insert to anon with check (public.valid_score(scores));
create policy scores_update on public.scores for update to anon using (true) with check (public.valid_score(scores));
create policy scores_delete on public.scores for delete to anon using (date >= current_date - 2);

-- Everything the app needs for the leaderboard, header and Play tab in ONE request.
-- Same shape as summarize() in stats.js. Streaks and bests are all-time.
create or replace function public.board(p_grp text, p_today date) returns json
language sql stable as $$
  with s as (select * from public.scores where grp = p_grp and date <= p_today),
  names as (
    select distinct on (name_key) name_key, name from s order by name_key, ts desc
  ),
  days as (select distinct name_key, date from s),
  islands as (
    select name_key, max(date) as last, count(*) as days
    from (select name_key, date, date - (row_number() over (partition by name_key order by date))::int as island from days) x
    group by name_key, island
  ),
  streaks as (select name_key, days, last from islands where last >= p_today - 1),
  bests as (
    select name_key, game, max(value) as hi, min(value) as lo
    from s where date < p_today group by name_key, game
  )
  select json_build_object(
    'today', to_char(p_today, 'YYYY-MM-DD'),
    'windowStart', '0000-00-00',
    'names', coalesce((select json_object_agg(name_key, name) from names), '{}'::json),
    'roster', coalesce((select json_agg(distinct name_key) from s where date >= date_trunc('month', p_today)::date), '[]'::json),
    'rows', coalesce((select json_agg(json_build_object(
              'group', grp, 'name', name, 'date', to_char(date, 'YYYY-MM-DD'), 'game', game,
              'value', value, 'label', label, 'puzzle', puzzle, 'ts', ts))
            from s where date >= p_today - 1), '[]'::json),
    'streaks', coalesce((select json_object_agg(name_key, json_build_object(
              'days', days, 'last', to_char(last, 'YYYY-MM-DD'), 'capped', false)) from streaks), '{}'::json),
    'bests', coalesce((select json_object_agg(name_key, g) from (
              select name_key, json_object_agg(game, json_build_object('hi', hi, 'lo', lo)) as g
              from bests group by name_key) b), '{}'::json)
  )
$$;
grant execute on function public.board(text, date) to anon;
