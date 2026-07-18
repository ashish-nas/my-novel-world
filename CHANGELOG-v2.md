# v2.0 Integration — Changelog

Applied directly into this zip. Extract over your project and everything below
is already in place — nothing left to hand-copy.

## Fixed
- **`supabase/functions/unsubscribe/index.ts`** was nested inside
  `send-chapter-email/`'s folder instead of being its own function — the
  Supabase CLI couldn't have found it to deploy. Moved to its correct location.
- **`my-library.html`** — Reading Goals widget no longer crashes if the
  `reading_goals` table write ever fails; shows a graceful fallback instead.
- **`index.html`** and **`book.html`** — book covers and titles said "MY NOVEL
  WORLD" as the author on every single book, regardless of who wrote it. Now
  shows the real pen name(s), fetched per book.

## Added — database
- **`schema-v2.sql`** (project root) — the full migration: Reading Goals +
  streak cron, the Writer/Author program (6 tables, 19 RLS policies, 4
  functions), and Donations. **This is the one piece that can't be "just
  extracted" — it has to be run in Supabase → SQL Editor by hand.** Before
  running it, find `YOUR-ADMIN-PROFILE-ID` in the file (appears once) and
  replace it with your own row's id from the `profiles` table.

## Added — pages
- `apply-writer.html`, `author.html`, `authors.html`
- `admin/writer-applications.html`, `admin/writers.html`, `admin/reports.html`
- `write/` — entirely new section, 9 pages (index, edit-book, volumes,
  edit-chapter, comments, reading-order, analytics, earnings, reports)

## Added — Stripe
- `supabase/functions/create-connect-account/`
- `supabase/functions/create-donation-checkout/`
- `supabase/functions/stripe-webhook/`
- `supabase/config.toml` — merged in the JWT-verification settings for all
  three (your existing `send-chapter-email`/`unsubscribe` entries are
  untouched)

## Changed
- **`js/app.js`** — added `requireWriter`, `isWriter`, `refreshProfile`,
  `callFunction`, and a gold "Write" nav button for approved Writers. Nothing
  existing was removed; `requireAuth`, `requireAdmin`, `toast`, `confirm`,
  etc. are byte-for-byte what you had.
- **`profile.html`** — added the application-status widget (Not applied /
  Pending / Approved / Rejected) right under Edit Profile.
- **`book.html`** — added the author byline under the title, a Support link
  when the author has Stripe connected, and (if you hadn't already applied it
  from earlier in this session) the `toggleNotify()` error-handling fix. Your
  copy already had that fix applied, so only the byline/Support parts were new
  here.

## Not touched, on purpose
`admin/books.html`, `admin/edit-chapter.html`, `admin/volumes.html`, and
`admin/comments.html` are superseded by `/write` — you'll use `/write` for
your own books now too, same as every other Writer. They're left in place
rather than deleted, since deleting existing files felt like it deserved an
explicit yes from you first. Safe to remove once you've confirmed `/write`
covers everything you need from them.

## Deploy checklist
1. Run `schema-v2.sql` in Supabase SQL Editor (after the id swap above).
2. `supabase functions deploy create-connect-account && supabase functions deploy create-donation-checkout && supabase functions deploy stripe-webhook && supabase functions deploy unsubscribe`
   (redeploy `unsubscribe` since its location changed).
3. Set secrets if you haven't: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `SITE_URL` — see the Stripe Connect Setup Guide (§11) in the Design
   Document v2.0 for exactly where each one comes from.
4. `git add . && git commit && git push` → Vercel deploys the rest automatically.

## Verified before delivery
Every embedded `<script type="module">` block across all 38 HTML pages in
this project was extracted and syntax-checked. All 5 Edge Functions
syntax-checked clean. Every `href`/`location.href` pointing at another page
on the site resolves to a real file. No duplicate element ids introduced. All
CSS classes used by new/changed markup were confirmed to exist (two gaps
found and fixed: `author.html`'s book grid was missing the book-card styles
that only ever lived inline in `index.html`, and both new admin pages were
missing the `filter-tabs`/`filter-count` styles that only ever lived inline
in `admin/comments.html` — both copied over so nothing renders unstyled).

## Second pass — asked to specifically re-check for mistakes

Went back through with fresh eyes rather than assuming the first pass caught
everything. Found and fixed seven more issues, three of them genuine security
gaps:

- **`suspend_writer()` / `reinstate_writer()` had no internal admin check.**
  Postgres grants EXECUTE on new functions to PUBLIC by default, and both are
  `SECURITY DEFINER` (they bypass RLS on purpose). Without a check inside the
  function itself, any signed-in reader could have called
  `db.rpc('suspend_writer', {...})` directly from the browser console and
  suspended anyone. Both functions now verify the caller is an admin before
  doing anything.
- **`book_authors` UPDATE policy allowed hijacking a co-author invite onto a
  different book.** The policy only checked that the caller owned the row
  being updated — it never stopped them from also rewriting `book_id` in that
  same update, which would grant them co-author access to a book they were
  never invited to. Fixed with a column-level grant restricting invitees to
  changing only `status`/`accepted_at`, never `book_id` or `user_id`.
- **`create-donation-checkout` and `create-connect-account` didn't check
  `suspended`.** The UI correctly hides the donate button and blocks
  `/write/earnings.html` for a suspended Writer, but neither Edge Function
  independently enforced that — a direct call would have worked anyway. Both
  now check it themselves rather than trusting the frontend.
- **`declineInvite()` and `removeCoAuthor()` couldn't actually work.** The
  only DELETE policy on `book_authors` required being the book's *creator* —
  but declining an invite is done by the *invitee*. Every decline was
  silently failing under RLS (and showing a false "declined" toast, since
  neither call checked for an error). Added a policy letting anyone remove
  their own row, and added the missing error checks.
- **The book-creation flow could silently strand a Writer.** After creating a
  book, the code adds you as its first author in a second insert — if that
  second insert ever failed, you'd be left with a book nobody (including you)
  could edit, since every content policy checks `book_authors`. It's no longer
  treated as a fire-and-forget step.
- **Admin's own `pen_name` was never set by anything.** Only
  `approve_writer_application()` sets `pen_name`, and the admin doesn't go
  through that flow — so without an explicit step, the admin's byline and
  author page would be blank, and they'd be filtered out of their own Authors
  directory (`authors.html` excludes NULL pen names). Added as an explicit
  step right next to the `created_by` migration, since both need the same id.
- **Six unchecked writes with unconditional success toasts** across
  `write/comments.html`, `write/volumes.html`, and `write/edit-book.html` —
  same class of bug as the `declineInvite` one above, just without the RLS
  failure to make it obvious. All now check for `error` before claiming
  success.
- Two small cleanups: an unused `callFunction` import in `book.html` left
  over from an earlier design (the Support button ended up being a plain
  link, not a JS call) and an unused `currentUser` import in
  `write/volumes.html`.

Re-ran the full syntax/tag-balance/link-resolution/duplicate-id verification
suite after every fix in this pass, not just at the end.
