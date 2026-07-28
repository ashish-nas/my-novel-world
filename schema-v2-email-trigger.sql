-- schema-v2-email-trigger.sql
--
-- send-chapter-email/index.ts has always been written to expect an
-- `on_chapter_published` Postgres trigger (see the comment at the top of
-- that file), but no such trigger exists anywhere in schema-v2.sql or
-- schema-v2-razorpay.sql. Without it, deploying the function does
-- nothing on its own — nothing ever calls it, so chapter-alert emails
-- silently never send. This file adds the missing trigger.
--
-- Run this in Supabase > SQL Editor, after schema-v2.sql and
-- schema-v2-razorpay.sql.
--
-- Uses pg_net (Supabase's built-in async HTTP extension) so the chapter
-- save itself doesn't block waiting on an email send.
--
-- Trigger secret filled in below: aa02e5b6a8be9eb2bed4cb3f5af52c6f28f6076534c62855
-- This MUST exactly match the TRIGGER_SECRET value you set as a Supabase
-- Edge Function secret for send-chapter-email (Part 4 of the deployment
-- guide) — same value, both places.

create extension if not exists pg_net with schema extensions;

create or replace function notify_chapter_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fires the first time a chapter becomes published — whether that's an
  -- UPDATE (draft flipped to published) or an INSERT (created already
  -- published). Won't re-fire on later edits to an already-published
  -- chapter, since OLD.published will already be true by then.
  if NEW.published = true and (OLD.published is distinct from NEW.published) then
    perform net.http_post(
      url := 'https://cjblsyitnezgpkykitax.supabase.co/functions/v1/send-chapter-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-trigger-secret', 'aa02e5b6a8be9eb2bed4cb3f5af52c6f28f6076534c62855'
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