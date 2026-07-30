-- schema-v2-email-trigger.sql
--
-- send-chapter-email/index.ts expects an `on_chapter_published` Postgres
-- trigger. This file creates it.
--
-- Run in Supabase > SQL Editor, after schema-v2.sql and
-- schema-v2-razorpay.sql.
--
-- Uses pg_net (Supabase's built-in async HTTP extension) so the chapter
-- save itself doesn't block waiting on an email send.
--
-- TRIGGER_SECRET: do NOT put the real value in this file. Before running
-- this in the SQL Editor, replace the placeholder below with the current
-- value from Supabase -> Edge Functions -> Secrets, run it, then discard
-- your pasted copy -- never `git add` a version with the real value in it.
-- (A previous version of this file had the real value committed in
-- plaintext, in commit ba57ed7. That value has been rotated and is dead;
-- this comment exists so the mistake doesn't repeat.)

create extension if not exists pg_net with schema extensions;

create or replace function notify_chapter_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fires the first time a chapter becomes published -- whether that's an
  -- UPDATE (draft flipped to published) or an INSERT (created already
  -- published). Won't re-fire on later edits to an already-published
  -- chapter, since OLD.published will already be true by then.
  if NEW.published = true and (OLD.published is distinct from NEW.published) then
    perform net.http_post(
      url := 'https://cjblsyitnezgpkykitax.supabase.co/functions/v1/send-chapter-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-trigger-secret', '<TRIGGER_SECRET_FROM_SUPABASE_DASHBOARD_DO_NOT_COMMIT>'
      ),
      body := jsonb_build_object('chapter_id', NEW.id)
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_chapter_published on chapters;

create trigger on_chapter_published
after insert or update on chapters
for each row
execute function notify_chapter_published();