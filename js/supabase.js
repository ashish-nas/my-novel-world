// ── Supabase Client ──────────────────────────
// Replace the two values below with yours from
// Supabase → Settings → API

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://cjblsyitnezgpkykitax.supabase.co";
const SUPABASE_KEY = "sb_publishable_sGKj7BDqudCfPYeRRe_rcQ_m04j7KfP";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

export default db;
