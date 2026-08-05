-- add-missing-qa-upvote-function.sql
--
-- qa.html calls db.rpc("increment_qa_upvote", { question_id }), but
-- this function doesn't exist in the live database or anywhere in
-- tracked SQL -- not drift, just never built. Right now every click on
-- a Q&A upvote button shows an error toast and does nothing.
--
-- SECURITY DEFINER is required: qa_questions has no policy letting a
-- regular reader UPDATE it directly (only "admin manage qa" touches
-- writes), so a plain function would be blocked by RLS the same way
-- the caller would be. No internal auth check, matching how the rest
-- of this feature is built to allow guests (qa.html tracks votes via
-- localStorage, not a per-user table).
--
-- Not pinning search_path here, to match the style of the existing
-- approve_writer_application() function -- worth revisiting for all
-- SECURITY DEFINER functions at once sometime, not just this one.

CREATE OR REPLACE FUNCTION increment_qa_upvote(question_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE qa_questions SET upvotes = upvotes + 1 WHERE id = question_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
