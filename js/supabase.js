// ── Supabase Client ──────────────────────────
// Replace the two values below with yours from
// Supabase → Settings → API

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://cjblsyitnezgpkykitax.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYmxzeWl0bmV6Z3BreWtpdGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTIzODksImV4cCI6MjA5NTk2ODM4OX0.zcNC-OgpYagXSerAZWyCRuRq9MN6E9uUMRlkAY8m2Gs';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

export default db;
