import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function isAuthorized(req: NextRequest) {
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${process.env.ADMIN_API_TOKEN}`;
}

/**
 * Reads from the LOCAL cache (this app's own database), never intake
 * directly — the dashboard should feel instant and work even mid-sync,
 * and the whole point of the cache is that this app never needs a live
 * round-trip to intake just to render a list.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('complaints')
    .select(
      'id, tracking_code, channel, status, encrypted_payload, admin_public_note, admin_internal_notes, review_status, review_statement, review_decision_note, intake_created_at, locally_dirty'
    )
    .order('intake_created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ complaints: data });
}
