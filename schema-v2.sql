-- ============================================================================
-- MY NOVEL WORLD — v2.0 migration
-- Run each PART in order, once, in Supabase → SQL Editor.
-- Covers: the Reading Goals bug fix, the full Writer/Author program, and
-- Donations. Gap fixes from the design doc review are folded in inline
-- and marked with "GAP FIX".
-- ============================================================================


-- ============================================================================
-- PART 1 — Reading Goals & Streaks (fixes the dead feature from the original
-- audit: my-library.html and profile.html already read/write this table, it
-- just never existed, and nothing ever incremented the streak).
-- ============================================================================

CREATE TABLE reading_goals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  weekly_target integer DEFAULT 3,
  current_streak integer DEFAULT 0,
  longest_streak integer DEFAULT 0,
  last_checked_week date,
  UNIQUE (user_id)
);

ALTER TABLE reading_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own reading goal"
  ON reading_goals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Weekly streak check. Deliberately plain SQL, not an Edge Function — this
-- is pure data manipulation with no external API to call, so a
-- pg_cron-scheduled Postgres function is simpler and has fewer moving parts
-- (no HTTP hop, no secrets, no cold starts) than routing it through a
-- function the way the email/Stripe features have to.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION check_reading_streaks()
RETURNS void AS $$
DECLARE
  g RECORD;
  done_this_week integer;
BEGIN
  FOR g IN SELECT * FROM reading_goals LOOP
    SELECT COUNT(*) INTO done_this_week
    FROM reading_progress
    WHERE user_id = g.user_id
      AND completed = true
      AND updated_at >= now() - interval '7 days';

    IF done_this_week >= g.weekly_target THEN
      UPDATE reading_goals SET
        current_streak = g.current_streak + 1,
        longest_streak = GREATEST(g.longest_streak, g.current_streak + 1),
        last_checked_week = now()::date
      WHERE id = g.id;
    ELSE
      UPDATE reading_goals SET
        current_streak = 0,
        last_checked_week = now()::date
      WHERE id = g.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- pg_cron calls this internally and doesn't need (or use) a PostgREST-level
-- grant to do so. Revoking public execute means no signed-in reader can
-- call it directly via the client SDK to force early or repeated streak
-- recalculation for themselves.
REVOKE EXECUTE ON FUNCTION check_reading_streaks() FROM PUBLIC;

SELECT cron.schedule(
  'weekly-streak-check',
  '0 0 * * 1',  -- every Monday at 00:00 UTC
  $$ SELECT check_reading_streaks(); $$
);


-- ============================================================================
-- PART 2 — Writer/Author Program
-- ============================================================================

-- profiles: new columns
ALTER TABLE profiles ADD COLUMN pen_name text UNIQUE; -- GAP FIX: uniqueness enforced
ALTER TABLE profiles ADD COLUMN bio text;
ALTER TABLE profiles ADD COLUMN suspended boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN suspended_reason text;

-- GAP FIX (found while building, not in the original review): v1.0's
-- "users update only their own profile" policy is a row-level check —
-- RLS alone doesn't stop a signed-in user from writing to ANY column on
-- their own row, including ones that grant privilege. Without this, a
-- reader could call the client SDK directly with
-- `update({ role: 'admin' })` or fake `stripe_charges_enabled: true` and
-- RLS would allow it. Column-level grants close that regardless of which
-- row policy exists: only these columns are writable by a signed-in user
-- through the API; role, suspended*, and the stripe_* columns become
-- writable only by the service role (i.e. only from inside an Edge
-- Function, after real verification).
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (username, avatar_url, pen_name, bio) ON profiles TO authenticated;

-- books: track the original creator
ALTER TABLE books ADD COLUMN created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- writer_applications
CREATE TABLE writer_applications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  pitch text NOT NULL,
  pen_name text NOT NULL,
  bio text,
  sample_url text,
  status text DEFAULT 'pending',
  applied_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE writer_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own applications"
  ON writer_applications FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users submit their own applications"
  ON writer_applications FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins manage every application"
  ON writer_applications FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Approving writes role/pen_name/bio onto the APPLICANT's profile row —
-- not the admin's own row, and role isn't in the self-service column
-- grant above anyway, so this has to be a privileged function rather
-- than a plain client-side update to two tables.
CREATE OR REPLACE FUNCTION approve_writer_application(application_id uuid)
RETURNS void AS $$
DECLARE
  app RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only an admin can approve applications';
  END IF;

  SELECT * INTO app FROM writer_applications WHERE id = application_id;

  UPDATE profiles SET role = 'writer', pen_name = app.pen_name, bio = app.bio
  WHERE id = app.user_id;

  UPDATE writer_applications SET status = 'approved', reviewed_at = now()
  WHERE id = application_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- book_authors
CREATE TABLE book_authors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status text DEFAULT 'invited',
  invited_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (book_id, user_id)
);

ALTER TABLE book_authors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Book authorship is publicly readable"
  ON book_authors FOR SELECT USING (true);

CREATE POLICY "Only the book's creator invites co-authors"
  ON book_authors FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM books WHERE id = book_id AND created_by = auth.uid()));

CREATE POLICY "Only the book's creator removes co-authors"
  ON book_authors FOR DELETE
  USING (EXISTS (SELECT 1 FROM books WHERE id = book_id AND created_by = auth.uid()));

-- GAP FIX (found on re-audit): write/index.html's declineInvite() is
-- called by the INVITEE to remove their own pending row — but the policy
-- above only lets the book's CREATOR delete rows, so a decline silently
-- failed under RLS with no error surfaced. This adds (doesn't replace)
-- self-removal: a user can always delete their own book_authors row,
-- whether that's declining an invite or an accepted co-author later
-- choosing to leave a book. Postgres OR's multiple permissive policies
-- together, so both this and the creator policy above remain active.
CREATE POLICY "A user can remove themselves from a book"
  ON book_authors FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "An invitee accepts or declines their own invite"
  ON book_authors FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- GAP FIX (found on re-audit): the policy above only checks that the
-- CALLER is the row's user_id — it doesn't stop them from also rewriting
-- book_id in that same update, which would let anyone with any pending
-- invite redirect it onto a completely different book and grant
-- themselves co-author access there. RLS's WITH CHECK can't compare
-- against the pre-update row on its own, so this needs a column-level
-- grant: an invitee can only ever change status/accepted_at through the
-- API, never which book or which user the row is about.
REVOKE UPDATE ON book_authors FROM authenticated;
GRANT UPDATE (status, accepted_at) ON book_authors TO authenticated;

-- Let any accepted co-author manage their book's volumes/chapters, on top
-- of (not instead of) your existing v1.0 admin-only policies — keeping
-- those is what makes the emergency suspend/remove lever in this section
-- actually work at the database level.
CREATE POLICY "Accepted co-authors manage their book's volumes"
  ON volumes FOR ALL
  USING (EXISTS (SELECT 1 FROM book_authors
    WHERE book_id = volumes.book_id AND user_id = auth.uid() AND status = 'accepted'))
  WITH CHECK (EXISTS (SELECT 1 FROM book_authors
    WHERE book_id = volumes.book_id AND user_id = auth.uid() AND status = 'accepted'));

CREATE POLICY "Accepted co-authors manage their book's chapters"
  ON chapters FOR ALL
  USING (EXISTS (SELECT 1 FROM book_authors
    WHERE book_id = chapters.book_id AND user_id = auth.uid() AND status = 'accepted'))
  WITH CHECK (EXISTS (SELECT 1 FROM book_authors
    WHERE book_id = chapters.book_id AND user_id = auth.uid() AND status = 'accepted'));

-- Writers also need to be able to create/edit their OWN books directly
-- (v1.0 only had an admin-only policy on books itself).
CREATE POLICY "Approved writers create books"
  ON books FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('writer','admin'))
  );

CREATE POLICY "Accepted co-authors update their book"
  ON books FOR UPDATE
  USING (EXISTS (SELECT 1 FROM book_authors
    WHERE book_id = books.id AND user_id = auth.uid() AND status = 'accepted'))
  WITH CHECK (EXISTS (SELECT 1 FROM book_authors
    WHERE book_id = books.id AND user_id = auth.uid() AND status = 'accepted'));

CREATE POLICY "Only the book's creator deletes it"
  ON books FOR DELETE
  USING (created_by = auth.uid());

-- reports
CREATE TABLE reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readers file reports"
  ON reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Only admins read the base reports table"
  ON reports FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Only admins update reports"
  ON reports FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Writer-facing view: same reports, reporter_id stripped out, scoped to
-- books this Writer is an accepted author on (covers both direct book
-- reports and reports on comments/reviews attached to their chapters).
CREATE VIEW writer_reports AS
SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at, ba.book_id
FROM reports r
JOIN book_authors ba ON (
  (r.target_type = 'book' AND r.target_id = ba.book_id)
  OR (r.target_type IN ('comment','review') AND r.target_id IN (
      SELECT c.id FROM comments c JOIN chapters ch ON ch.id = c.chapter_id WHERE ch.book_id = ba.book_id
      UNION
      SELECT rv.id FROM reviews rv WHERE rv.book_id = ba.book_id
  ))
)
WHERE ba.user_id = auth.uid() AND ba.status = 'accepted';

GRANT SELECT ON writer_reports TO authenticated;

-- Emergency suspend / reinstate.
-- SECURITY DEFINER functions get EXECUTE granted to PUBLIC by default in
-- Postgres, and this function bypasses RLS internally — so without an
-- explicit admin check here, ANY signed-in user could call this directly
-- via the client SDK (db.rpc('suspend_writer', {...})) and suspend anyone.
-- The admin-only gate has to live inside the function, not just in the
-- admin UI that happens to be the only place that calls it today.
CREATE OR REPLACE FUNCTION suspend_writer(target_user_id uuid, reason text)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only an admin can suspend a Writer';
  END IF;

  UPDATE profiles SET suspended = true, suspended_reason = reason WHERE id = target_user_id;

  UPDATE books SET published = false
  WHERE id IN (SELECT book_id FROM book_authors WHERE user_id = target_user_id AND status = 'accepted')
    AND id NOT IN (SELECT book_id FROM book_authors WHERE user_id != target_user_id AND status = 'accepted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reinstate_writer(target_user_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only an admin can reinstate a Writer';
  END IF;

  UPDATE profiles SET suspended = false, suspended_reason = NULL WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- One-time migration: attribute every existing book to you, and record
-- you as its accepted author so the new co-author policies above
-- recognize your existing content immediately.
-- Replace YOUR-ADMIN-PROFILE-ID with your own row's id from profiles.
UPDATE books SET created_by = 'YOUR-ADMIN-PROFILE-ID' WHERE created_by IS NULL;

-- GAP FIX (found on re-audit): pen_name only ever gets set by
-- approve_writer_application() — but you never go through that flow, so
-- without this, your own pen_name stays NULL. That breaks three things
-- silently: your byline on your own books falls back to "My Novel World"
-- instead of your name, your author page shows a blank title, and
-- authors.html's directory query filters out anyone with a NULL pen_name
-- — so you wouldn't even appear in your own Authors directory.
-- Replace both the id AND the name below with your own.
UPDATE profiles SET pen_name = 'YOUR-PEN-NAME' WHERE id = 'YOUR-ADMIN-PROFILE-ID';

INSERT INTO book_authors (book_id, user_id, status, accepted_at)
SELECT id, created_by, 'accepted', now() FROM books WHERE created_by IS NOT NULL;


-- Per-Writer series order — shown on a Writer's own Author Profile page.
-- Deliberately a separate table from the existing sitewide reading_order
-- (admin's cross-catalog curated list, unchanged) rather than reusing it:
-- these are two different concepts (one writer's own series sequence vs.
-- a site-wide "start here" guide across every author).
CREATE TABLE writer_series_order (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  writer_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  sort_order integer DEFAULT 0,
  note text,
  UNIQUE (book_id, writer_id)
);

ALTER TABLE writer_series_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Series order is publicly readable"
  ON writer_series_order FOR SELECT USING (true);

CREATE POLICY "Accepted co-authors manage their book's series order"
  ON writer_series_order FOR ALL
  USING (
    writer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM book_authors
      WHERE book_id = writer_series_order.book_id AND user_id = auth.uid() AND status = 'accepted')
  )
  WITH CHECK (
    writer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM book_authors
      WHERE book_id = writer_series_order.book_id AND user_id = auth.uid() AND status = 'accepted')
  );


-- ============================================================================
-- PART 3 — Donations
-- ============================================================================

ALTER TABLE profiles ADD COLUMN stripe_account_id text;
ALTER TABLE profiles ADD COLUMN stripe_charges_enabled boolean DEFAULT false;

CREATE TABLE donations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  donor_id uuid REFERENCES profiles(id),
  writer_id uuid REFERENCES profiles(id),
  book_id uuid REFERENCES books(id),
  amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL,
  currency text DEFAULT 'usd',
  stripe_payment_intent_id text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE donations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Donor and recipient can see a donation"
  ON donations FOR SELECT
  USING (auth.uid() = donor_id OR auth.uid() = writer_id);

-- Deliberately no client-side INSERT policy — donations are written only
-- by the create-donation-checkout / stripe-webhook Edge Functions using
-- the service role key, after Stripe confirms the charge succeeded.
