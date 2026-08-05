-- schema-v2-public-read.sql
--
-- Reconstructed from MyNovelWorld-SessionSummary-v5.md -- this was run
-- directly in the Supabase SQL Editor and never saved to the repo.
-- Review against Table Editor > books/volumes/chapters > RLS Policies
-- before running. This only covers what the summary describes (public
-- read of published rows) -- it doesn't touch whatever admin/write
-- policies already exist live, since those aren't visible from the
-- tracked code.
--
-- Bug this fixes: with RLS on and no SELECT policy, every read of these
-- tables returned zero rows to every visitor -- the homepage showed
-- "0 novels" regardless of what was actually published.

alter table books enable row level security;
alter table volumes enable row level security;
alter table chapters enable row level security;

drop policy if exists "public can read published books" on books;
create policy "public can read published books"
on books for select
using (published = true);

drop policy if exists "public can read published volumes" on volumes;
create policy "public can read published volumes"
on volumes for select
using (published = true);

drop policy if exists "public can read published chapters" on chapters;
create policy "public can read published chapters"
on chapters for select
using (published = true);
