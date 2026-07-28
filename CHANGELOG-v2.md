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
  only DELETE policy on `book_authors` required being the book's _creator_ —
  but declining an invite is done by the _invitee_. Every decline was
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
direct equivalent to Stripe Connect and found it's _also_ gated — a
September 2025 RBI rule requires \u20b940L+ domestic turnover or \u20b95L+ export
turnover, which cut off real businesses that didn't qualify starting January 2026. A brand-new site has none of that revenue.

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

## Fifth pass — general security hardening

Asked to specifically look for ways the site could be attacked, beyond the
database-level RLS work in earlier passes. Found real, exploitable issues —
this wasn't just a precautionary pass.

**Critical: stored XSS via chapter content, completely unsanitized.**
`chapter.html` rendered `chapters.content` — full rich-text HTML straight
from the Quill editor — with a raw `innerHTML` assignment and zero
sanitization. In v1.0, with a single trusted author, that was low-risk. It
stopped being low-risk the moment multiple, less-vetted Writers could
publish directly with no review step: anyone bypassing the Quill UI and
calling the API directly (trivial — it's just `chapters.update({content:
...})`) could plant a script tag that executes for every reader of that
chapter. Fixed by sanitizing through DOMPurify before rendering, on both
`chapter.html` (the critical, public-facing one) and `updates.html` (lower
risk since author posts are admin-only today, fixed anyway for consistency
and in case that ever changes).

**The apostrophe bug from the very first review of this project turned out
to be a real script-injection vector, not just a cosmetic one.**
`deleteBook`/`deleteVol`/`deleteChapter` in the admin pages built their
`onclick` handlers by directly concatenating the book/chapter title into the
attribute string. A title containing a single quote followed by JavaScript
would break out of the intended function call and execute as part of the
`onclick` handler itself — in the _admin's own_ browser session. Originally
flagged as "breaks with apostrophes"; with multiple Writers now able to set
titles instead of one trusted admin, it's actually an injection vector
targeting whoever's logged in as admin. Fixed using the same safe
JSON-embedding pattern `editBook`/`editVol` already used elsewhere in the
same files — HTML-entity-encoding the quotes so the browser's own parser
reconstructs valid JS, rather than raw string concatenation.

**~20 places rendered a title, bio, username, or review as raw HTML with no
escaping at all** — `index.html` (the homepage), `my-library.html`,
`volume.html`, `book.html` (including reader-submitted reviews — reachable
by any registered reader, no Writer status required), `profile.html`,
`author.html`/`authors.html`, and the admin dashboard. Same underlying
issue as the two above: content that was effectively "written by the one
person who runs this site" in v1.0 is now written by many people with
varying levels of trust, and the code never adjusted. All escaped now.

**Open redirect on the login page.** `?redirect=` went straight from the
URL into `location.href` with no validation. A link like
`login.html?redirect=https://evil.example` would bounce someone who'd just
authenticated on the real site straight to an attacker's page — a standard
phishing technique. Now only same-origin relative paths are accepted;
anything else falls back to `/admin/`.

**Added security headers** (`vercel.json`): `Content-Security-Policy`,
`Referrer-Policy`, `Permissions-Policy`, alongside the `X-Content-Type-Options`
and `X-Frame-Options` that were already there. One honest limitation worth
knowing: the CSP allows `'unsafe-inline'` for scripts, because every page on
this site is a single inline `<script type="module">` block — there's no
build step to introduce nonces or move everything to external files without
a much bigger restructure than a security pass. The CSP still meaningfully
restricts _which domains_ can load scripts/styles/fonts/images and blocks
data exfiltration to arbitrary servers via `connect-src` — real protection,
just not a complete substitute for the output-escaping fixes above, which
are what's actually closing the XSS holes.

**Test the Razorpay checkout flow after deploying this.** CSP and payment
popups/iframes have a documented history of friction with each other. I
allowed `https://*.razorpay.com` broadly across `script-src`, `connect-src`,
and `frame-src` specifically to minimize the chance of silently breaking a
real donation, but I can't fully verify Razorpay's internal domain usage
without a live checkout to test against. If a payment fails to open or
submit after this deploys, the CSP line in `vercel.json` is the first thing
to loosen — check the browser console for the specific blocked domain and
add it there.

**Not done, and why:** true rate-limiting on public write endpoints
(applications, reports, comments, order creation) isn't addressed here.
Supabase's free tier doesn't expose simple per-user throttling, and building
it properly (tracking attempts, windowing, etc.) is a genuinely separate
piece of work rather than a quick addition to this pass — flagging it as a
known gap rather than quietly shipping a partial version.

## Sixth pass — Stripe files removed for real this time

The Fourth pass entry above says `create-connect-account`,
`create-donation-checkout`, and `stripe-webhook` were "gone, not just
unused." That was the intent, but checking the actual repo (asked for
specifically, rather than trusting the prior write-up) found all three
still sitting in `supabase/functions/`, still tracked by git. The
database-side half of that cleanup — dropping `profiles.stripe_account_id`
and `profiles.stripe_charges_enabled` in `schema-v2-razorpay.sql` — was
correct and untouched; it was specifically these three function files that
never actually got deleted.

Confirmed nothing calls any of the three anymore (`create-razorpay-order`
is the only Edge Function `callFunction()` invokes, from `author.html`)
before deleting them now. Also fixed a stale comment in `js/app.js` that
still described `callFunction` as serving "the Stripe connect flow" — it
only serves the Razorpay donate widget now. `supabase/functions/` contains
exactly the four functions that should be deployed: `create-razorpay-order`,
`razorpay-webhook`, `send-chapter-email`, `unsubscribe`.

## Seventh pass — critical: real secrets were hardcoded in source

While preparing the deployment walkthrough, `Deno.env.get()` calls in
`send-chapter-email/index.ts` and `unsubscribe/index.ts` turned out to
have real secret _values_ passed as the lookup argument instead of an
env var _name_ — e.g. `Deno.env.get("<actual JWT>")` instead of
`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Decoded the JWT to confirm:
it's a genuine Supabase `service_role` key for this project (bypasses RLS
entirely, full read/write on every table), not a placeholder. A live-looking
Resend API key and the email trigger secret were exposed the same way.
This was already committed locally (one commit, never pushed).

Fixed both files to look up the correct env var names
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`TRIGGER_SECRET`, `SITE_URL`) instead of hardcoding values. The first two
are auto-provided by Supabase to every Edge Function; the rest need
setting as secrets — see the deployment guide. **The exposed keys should
be treated as compromised and rotated, not just removed from source** —
fixing the code doesn't undo a key having existed in plaintext.

Also found and removed `supabase/functions/send-chapter-email/unsubscribe/`
— a byte-for-byte duplicate of the real `supabase/functions/unsubscribe/`,
nested one level too deep to ever be deployed as its own function. Just
dead weight, tracked by git for no reason.

Separately: `send-chapter-email/index.ts` has always said it's called by
an `on_chapter_published` Postgres trigger, but no such trigger exists in
`schema-v2.sql` or `schema-v2-razorpay.sql` — checked both. Added
`schema-v2-email-trigger.sql` to actually create it. Without this,
deploying the function would have done nothing; chapter-alert emails
would have silently never sent.

## Eighth pass — legacy Supabase keys can't be individually rotated

Turns out fixing where the service role key was _stored_ wasn't the end
of it. Attempting the actual key rotation surfaced that this project's
legacy `anon`/`service_role` keys are both JWTs signed by one shared
HS256 secret, and Supabase no longer allows rotating that secret in
isolation — the only lever is revoking it entirely, which invalidates
every legacy key issued from it at once, `anon` included. There's no way
to get a "new" legacy-format key; Supabase's own dashboard already points
at the real fix, which is migrating off the legacy format.

Migrated: `js/supabase.js` now uses a `sb_publishable_...` key instead of
the old anon JWT. All 4 Edge Functions now read a `SUPABASE_SECRET_KEY`
secret (set explicitly, not auto-injected — Supabase does auto-provide a
`SUPABASE_SECRET_KEYS` JSON blob to Edge Functions now, but parsing that
felt like an unnecessary extra failure point for a same-day fix when
setting one named secret directly is just as correct and easier to
verify). `SUPABASE_SERVICE_ROLE_KEY` is no longer referenced anywhere in
this codebase.

The old HS256 secret is still sitting there, un-revoked, by design for
now — revoking it is the actual kill switch for the leaked key, but it
should only happen after the new keys are deployed and confirmed working
end to end. Doing it first would take the whole site down along with the
leaked key.

## Ninth pass — reading_goals already existed in the live database

Running `schema-v2.sql` for real (not just reviewing it) hit
`relation "reading_goals" already exists" on the very first statement.
The PART 1 comment claims this table "just never existed" — that was
wrong, at least for this project's actual Supabase instance. Checked
directly against `information_schema`/`pg_catalog`rather than guessing:
the live table is schema-identical to what the script would have created
— same columns/types/defaults, same primary key, same`UNIQUE(user_id)`,
same FK with `ON DELETE CASCADE`, RLS already on, and an existing policy
with identical `USING`/`WITH CHECK`logic (named`own rows` instead of
the script's name, functionally the same). It already held 2 real rows.

Rather than drop and recreate — pointless risk to real data for a table
that's already correct — `schema-v2.sql`'s PART 1 now skips creating
`reading_goals` entirely and moves straight to `check_reading_streaks()`
and the pg_cron schedule, both of which were confirmed genuinely absent
before writing this fix, not assumed absent.

Checked everything else PART 2 and PART 3 touch the same way before
concluding this was the only landmine: every other table, column,
function, extension, and view came back `false` against the live
database. Nothing else needed changing.

## Tenth pass — schema-v2-razorpay.sql didn't match its own claim

Its header says "every statement below is idempotent" before handing off
to `schema-v2.sql`. Checked that claim against the actual statements
rather than trusting it given the last file's track record: two of them
weren't. `RENAME COLUMN stripe_payment_intent_id TO razorpay_payment_id`
has no guard — errors if run a second time, or if the column's already
been renamed by anything else. `CREATE POLICY "Only admins mark
donations as paid out"` has no `IF NOT EXISTS` form in Postgres at all —
same problem, different mechanism.

Neither was a live bug: `donations` was only just created in this same
session, so both were safe to run once, exactly as originally written.
Fixed anyway, so the file's re-runnable the way it already claimed to
be — wrapped the rename in a guarded `DO` block that checks
`information_schema` first, and switched the policy to the standard
drop-then-create idiom. Nothing about the actual migration logic
changed, only whether running this file twice is safe.

## Eleventh pass — the replacement secret name was itself invalid

Self-inflicted, from the Eighth pass fix: naming the new explicit secret
`SUPABASE_SECRET_KEY` seemed like the obvious, descriptive choice at the
time. It's also invalid — `supabase secrets set` silently rejects any
custom secret name starting with `SUPABASE_`, since that prefix is
reserved for Supabase's own auto-injected variables. Running the actual
`secrets set` command surfaced this directly: `Env name cannot start with
SUPABASE_, skipping: SUPABASE_SECRET_KEY`. The other 6 secrets in that
same command set correctly; this one silently didn't, and all 4 Edge
Functions deployed successfully on top of it — meaning they deployed in
a broken state, reading a secret that was never actually set. Not
exploitable, but nonfunctional: every one of them would have failed the
moment anything tried to use their database client.

Renamed to `SB_SECRET_KEY` throughout — same value, name that doesn't
collide with the reserved prefix. Fixed in all 4 function files, plus
the deployment guide's Part 0 checklist, Part 4 command, and quick
reference table, so nothing downstream still points at the old name.
