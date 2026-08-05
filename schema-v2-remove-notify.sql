-- schema-v2-remove-notify.sql
--
-- Reverts schema-v2-email-trigger.sql. Reconstructed with high
-- confidence -- the trigger and function names below are copied
-- directly from that file, not guessed.
--
-- The Notify/email-alert feature was removed entirely this session:
-- reaching real subscribers needed either a purchased domain or a
-- rewrite around Gmail SMTP, and the call was to cut the feature
-- instead. email_subscriptions itself is left in place, empty and
-- harmless -- see schema-v2-drop-email-subscriptions.sql if it's ever
-- worth dropping for real (optional, may never run).

drop trigger if exists on_chapter_published on chapters;
drop function if exists notify_chapter_published();
