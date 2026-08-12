import { NextRequest, NextResponse } from 'next/server';

/**
 * Runs before EVERY request to this app, including the login page itself
 * — an IP not on the allowlist can't even reach the passphrase prompt,
 * let alone anything behind it. This is the actual access-control
 * boundary the "separate server" request was about; everything else
 * (passphrase, admin token) is defense-in-depth behind this.
 *
 * On Vercel specifically, x-forwarded-for is set by Vercel's own edge
 * network and can't be spoofed by the client the way it could on an
 * arbitrary self-hosted reverse proxy — Vercel's docs are explicit that
 * they overwrite this header and don't forward whatever a client sends.
 * That's what makes this a real control rather than a header an attacker
 * could just set themselves. If you ever move this off Vercel, re-verify
 * that property holds for wherever it lands, or this check becomes
 * trivially bypassable.
 *
 * ADMIN_ALLOWED_IPS is a comma-separated list, e.g. "203.0.113.4" or
 * "203.0.113.4,198.51.100.9" if you ever add a second location. Whatever
 * ISP you're on at home, your IP can change — check
 * https://vercel.com/your-team/your-project/logs after a 403 to see what
 * showed up, and update the env var.
 */
const ALLOWED_IPS = (process.env.ADMIN_ALLOWED_IPS ?? '')
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);

export function middleware(req: NextRequest) {
  if (ALLOWED_IPS.length === 0) {
    // Fail CLOSED, not open: a misconfigured/missing env var should never
    // silently mean "allow everyone." If you're bootstrapping and
    // genuinely have no IP yet, that's still not a reason to open this up
    // — go find your current IP first.
    return new NextResponse('Admin access is not configured.', { status: 503 });
  }

  const forwardedFor = req.headers.get('x-forwarded-for') ?? '';
  const clientIp = forwardedFor.split(',')[0]?.trim();

  if (!clientIp || !ALLOWED_IPS.includes(clientIp)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets AND /api/sync. That route is meant
  // to be triggered by Vercel Cron itself, which calls it from Vercel's
  // own infrastructure — not the admin's home IP — so it CANNOT go
  // through this allowlist or the cron would simply never fire. It has
  // its own, different, and equally real check instead: Vercel signs
  // cron-triggered requests with `Authorization: Bearer <CRON_SECRET>`
  // automatically, which /api/sync verifies itself. Manually hitting
  // /api/sync from the dashboard (e.g. a "sync now" button) would need
  // to send that same header — see the route for how.
  matcher: '/((?!_next/static|_next/image|favicon.ico|api/sync).*)',
};
