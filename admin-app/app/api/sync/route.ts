import { NextRequest, NextResponse } from 'next/server';
import { pullFromIntake } from '@/lib/sync/orchestrate';

/**
 * Configure in vercel.json:
 *   { "crons": [{ "path": "/api/sync", "schedule": "*\/2 * * * *" }] }
 * (every 2 minutes — adjust to taste; this only ever reads from intake via
 * sync_reader and writes to THIS app's own database, so there's no real
 * cost to running it often other than Supabase/Vercel usage.)
 *
 * This route is deliberately excluded from middleware.ts's IP allowlist
 * — Vercel triggers cron jobs from its own infrastructure, not the
 * admin's home IP, so the allowlist would block every scheduled run.
 * Vercel compensates by automatically attaching this same
 * `Authorization: Bearer <CRON_SECRET>` header to cron-triggered
 * requests, which is what's actually being checked below — a real,
 * Vercel-verified credential, not just an IP that happens not to apply
 * here. A "sync now" button in the dashboard would need to send that
 * same header explicitly to call this route on demand.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  // Two independent, legitimate callers: Vercel Cron (CRON_SECRET, which
  // Vercel attaches automatically) and the dashboard's manual "Sync now"
  // button (ADMIN_API_TOKEN, the same token that already gates every
  // other /api/complaints call — the admin is already authenticated by
  // the time they can click that button, so reusing it here is correct
  // rather than needing a THIRD secret). Neither token is ever shipped
  // to the browser as NEXT_PUBLIC_ — ADMIN_API_TOKEN reaches the client
  // only because the admin typed it into AdminTokenGate this session and
  // it lives in React state, never in an env var the bundler inlines.
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = auth === `Bearer ${process.env.ADMIN_API_TOKEN}`;
  if (!isCron && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await pullFromIntake();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
