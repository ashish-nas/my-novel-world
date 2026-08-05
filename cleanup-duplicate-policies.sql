-- cleanup-duplicate-policies.sql
--
-- The audit turned up ~15 policies across 10 tables that duplicate an
-- already-existing policy on the same table -- same command, same
-- predicate, just a different name. Not a security hole: Postgres OR's
-- permissive policies together, so duplicates are redundant, not
-- conflicting. Still worth clearing out so the policy list reflects
-- what's actually true.
--
-- Includes dropping the two I personally added in
-- schema-v2-public-read.sql (books, volumes) plus its third sibling on
-- chapters -- public read access on all three already worked before
-- that file was ever written. My mistake, fixed below.
--
-- Caveat: this compares on (cmd, using, check) only -- the audit didn't
-- capture the `roles` column, so if any pair secretly differs on which
-- DB role it applies to, dropping one could narrow access slightly.
-- Worth a glance at Table Editor > RLS first if you want to be sure;
-- every using()/check() clause is already sitting in the audit output
-- to recreate from if something breaks.

-- books, volumes, chapters: keep the original "Public read published
-- X", drop the other two duplicates on each (including mine)
drop policy if exists "public can read published books" on books;
drop policy if exists "public read books" on books;

drop policy if exists "public can read published volumes" on volumes;
drop policy if exists "public read volumes" on volumes;

drop policy if exists "public can read published chapters" on chapters;
drop policy if exists "public read chapters" on chapters;

-- characters: keep "admin manage characters" (ALL) + "public read
-- characters"; drop the redundant admin pair
drop policy if exists "admin write characters" on characters;
drop policy if exists "admin read characters" on characters;

-- comments: keep "public read comments", drop the duplicate
drop policy if exists "public read approved" on comments;

-- countdowns: keep "admin manage countdowns", drop the duplicate
drop policy if exists "admin full access countdowns" on countdowns;

-- page_views: keep "admin view analytics", drop the duplicate
drop policy if exists "admin read page views" on page_views;

-- profiles: keep "public read profiles", drop the duplicate
drop policy if exists "anyone read profiles" on profiles;

-- reading_order: keep "admin manage reading_order" + "public read
-- reading order"; drop both duplicates
drop policy if exists "admin full access reading order" on reading_order;
drop policy if exists "public read order" on reading_order;

-- theories: keep "public read theories", drop the duplicate
drop policy if exists "anyone can read theories" on theories;
