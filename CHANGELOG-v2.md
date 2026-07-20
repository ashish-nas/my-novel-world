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
1. Run `schema-v2.sql` in Supabase SQL Editor (after the two id/name swaps
   near the bottom), **then** run `schema-v2-razorpay.sql` — it's a
   supplementary migration, run it after, not instead of, the main one.
2. `supabase functions deploy create-razorpay-order && supabase functions deploy razorpay-webhook && supabase functions deploy unsubscribe`
   (redeploy `unsubscribe` too — its location changed earlier in this doc).
3. Set secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL` — see the section below for
   where each comes from. (`SUPABASE_SERVICE_ROLE_KEY` doesn't need
   setting — Supabase provides it automatically.)
4. In Razorpay Dashboard → Settings → Webhooks, add an endpoint pointing to
   `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`,
   subscribed to the `payment.captured` event. This is where the webhook
   secret in step 3 comes from.
5. `git add . && git commit && git push` → Vercel deploys the rest automatically.

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

## Third pass — closing the self-service deletion gap

You'd decided Writers can delete their own books and accounts without going
through Admin, but there was no actual button for either. Fixed the
book-level half of that:

- **`write/edit-book.html`** now has a Delete Book button, shown only to the
  book's creator (matching exactly who the RLS `DELETE` policy already
  authorizes) — deletes the book and everything under it.
- **`created_by`'s foreign key had no `ON DELETE` behavior specified at
  all**, which defaults to blocking the delete outright — a creator
  couldn't have deleted their own account while they still owned any book,
  solo or co-authored. Now `ON DELETE SET NULL`, so the account can go and
  a co-authored book survives for its remaining authors. A solely-authored
  book loses its manager (nobody left who can invite/remove co-authors on
  it) — an inherent tradeoff of letting the account disappear at all, not a
  bug, but worth knowing.

Full account deletion (not just a book) is still not built — see the reply
this changelog shipped alongside for why that's a separate decision, not
just more code.

## Fourth pass — Stripe replaced with Razorpay entirely

Stripe turned out to be a dead end for this project: new India accounts are
invite-only, and even an invite requires a registered business, not an
individual. Looked at Razorpay's own multi-party product (Route) as the
direct equivalent to Stripe Connect and found it's *also* gated — a
September 2025 RBI rule requires \u20b940L+ domestic turnover or \u20b95L+ export
turnover, which cut off real businesses that didn't qualify starting January
2026. A brand-new site has none of that revenue.

So this switches to a different model entirely: **you collect, you pay
out.** One Razorpay account, in your name, collects every donation. The
database tracks who each one was for and whether you've paid that Writer
their share yet. You send it yourself, monthly, via UPI, then mark it paid.

**Removed:**
- `create-connect-account`, `create-donation-checkout`, `stripe-webhook` —
  gone, not just unused. They could never have worked given the account
  restrictions above, and leaving dead code that references a blocked
  payment flow seemed more likely to cause confusion than help.
- `profiles.stripe_account_id`, `profiles.stripe_charges_enabled` — dropped
  in `schema-v2-razorpay.sql`.

**Added:**
- `schema-v2-razorpay.sql` — supplementary migration. Safe to run whether
  or not you'd already run the Stripe version of Part 3, since every
  statement is idempotent.
- `create-razorpay-order` — creates a Razorpay Order for a donation. Checks
  the recipient is an approved, non-suspended Writer with a UPI id set
  before allowing it — all three, not just the UPI id, since UPI id alone
  turned out to be settable by any signed-in user, not just Writers (see
  below).
- `razorpay-webhook` — the only place a donation actually gets recorded,
  same "never trust the client alone" principle as the Stripe version had.
  Verifies `x-razorpay-signature` via HMAC-SHA256 against the raw request
  body before touching anything.
- `admin/payouts.html` — every Writer with money owed, their UPI id, a
  running total, and a Mark Paid button. Purely a record-keeper; nothing on
  this page moves money on its own.
- `write/earnings.html` — rebuilt around a UPI id field instead of a Stripe
  connect flow, with pending vs. already-paid amounts shown separately.

**Currency:** real USD processing turned out to be gated too — Razorpay
requires an account already active on domestic payments, a banking-partner
approval process, and in some of their documented paths a settlement
history from a prior payment provider. None of that is available to a new
account either. Donations are in \u20b9 throughout now; the rest of the
project's existing $ references (design doc prose, etc.) weren't touched,
since those were never live money, just labels.

**Found while rebuilding:**
- `admin/index.html` — the site owner's own dashboard — had never been
  updated with links to Applications, Writers, Reports, or now Payouts.
  Every other admin page had them; this one didn't, plus it still pointed
  at the superseded Novels/Comments pages. Brought in line with the rest.
- The Writer-eligibility check for receiving a donation verified UPI id and
  suspension status but never verified the recipient is actually an
  approved Writer. Since `upi_id`'s column grant allows any signed-in user
  to set it on their own row — not just approved Writers — a regular
  reader could have set their own UPI id and, if someone navigated to their
  `author.html` page directly by id, received a donation never meant for
  them. Added the missing role check at the point that actually initiates
  a payment, plus tightened `author.html`'s own query the same way so a
  non-Writer's page doesn't render Writer UI even if visited directly.
- An embedded-relation query in the first draft of `admin/payouts.html`
  guessed at Postgres's auto-generated foreign key constraint name
  (`donations_writer_id_fkey`) to disambiguate which of `donations`' two
  profile references to join through. It was probably right, but "probably"
  isn't good enough for a page you'll depend on every month — replaced with
  two plain queries joined in JavaScript, which doesn't depend on guessing
  anything.

