import { createClient } from '@supabase/supabase-js';

/**
 * SERVER-ONLY, and points at THIS app's own database (the admin cache),
 * not intake — for intake, see lib/sync/intakeClient.ts, which uses
 * scoped sync_reader/sync_writer JWTs instead of a service-role key.
 * Never import this file from a 'use client' component.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/supabaseAdmin.ts must never be imported in browser code.');
}

export const supabaseAdmin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
