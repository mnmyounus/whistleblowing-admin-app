import { NextRequest, NextResponse } from 'next/server';
import { pushLocalEdit } from '@/lib/sync/orchestrate';

type RouteContext = { params: Promise<{ id: string }> };

const ALLOWED_FIELDS = ['status', 'admin_public_note', 'admin_internal_notes', 'review_decision_note', 'review_status'];

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.ADMIN_API_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in body) patch[field] = body[field];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  try {
    // Writes locally first (marking the row dirty), then pushes to intake
    // immediately, then clears the dirty flag on confirmed success. If
    // the push fails, this throws and the row stays dirty — the edit is
    // NOT lost, but it also hasn't reached intake yet. See orchestrate.ts.
    await pushLocalEdit(id, patch);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), savedLocallyButNotPushed: true },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
