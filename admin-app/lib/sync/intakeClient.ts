import { mintSyncReaderToken, mintSyncWriterToken } from './intakeAuth';

/**
 * Talks to the INTAKE project's PostgREST endpoint directly (not via
 * @supabase/supabase-js, which is built around a single fixed key per
 * client — this needs to swap between sync_reader and sync_writer
 * per-request). Every call here is plain HTTPS to /rest/v1/..., which is
 * why this bridge needs no direct Postgres connection and sidesteps the
 * free-tier IPv4/IPv6 issue entirely.
 *
 * INTAKE_URL is the intake project's URL (e.g. https://xxxx.supabase.co)
 * — a different project than this admin app's own SUPABASE_URL.
 * INTAKE_ANON_KEY is intake's publishable/anon key: PostgREST still wants
 * an apikey header to identify the project even though the JWT's role
 * claim is what actually determines privileges here, not this key.
 */
const INTAKE_URL = process.env.INTAKE_URL;
const INTAKE_ANON_KEY = process.env.INTAKE_ANON_KEY;

function assertConfigured() {
  if (!INTAKE_URL || !INTAKE_ANON_KEY) {
    throw new Error('INTAKE_URL / INTAKE_ANON_KEY are not configured.');
  }
}

interface IntakeFetchOptions {
  method?: 'GET' | 'PATCH';
  query?: string; // raw PostgREST query string, e.g. "select=id,status&updated_at=gt.2026-01-01"
  body?: unknown;
  extraHeaders?: Record<string, string>;
}

async function intakeFetch(role: 'sync_reader' | 'sync_writer', table: string, opts: IntakeFetchOptions = {}) {
  assertConfigured();
  const token = role === 'sync_reader' ? await mintSyncReaderToken() : await mintSyncWriterToken();
  const url = `${INTAKE_URL}/rest/v1/${table}${opts.query ? `?${opts.query}` : ''}`;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      apikey: INTAKE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.method === 'PATCH' ? { Prefer: 'return=minimal' } : {}),
      ...opts.extraHeaders,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Intake PostgREST ${opts.method ?? 'GET'} ${table} failed: ${res.status} ${detail}`);
  }
  return res;
}

// ---- reads (sync_reader) ---------------------------------------------

export interface IntakeComplaintRow {
  id: string;
  tracking_code: string;
  channel: string;
  status: string;
  encrypted_payload: unknown;
  encrypted_proof_path: string | null;
  encrypted_proof_key: unknown;
  admin_public_note: string | null;
  admin_internal_notes: unknown;
  review_status: string;
  review_statement: unknown;
  review_decision_note: string | null;
  created_at: string;
  updated_at: string;
}

/** Complaints changed since `sinceIso` (or all, if omitted), newest-updated first. */
export async function fetchChangedComplaints(sinceIso?: string): Promise<IntakeComplaintRow[]> {
  const filters = sinceIso ? `&updated_at=gt.${encodeURIComponent(sinceIso)}` : '';
  const res = await intakeFetch('sync_reader', 'complaints', {
    query: `select=*${filters}&order=updated_at.asc&limit=500`,
  });
  return res.json();
}

// ---- writes (sync_writer) ---------------------------------------------

export interface IntakeComplaintPatch {
  status?: string;
  admin_public_note?: string | null;
  admin_internal_notes?: unknown;
  review_status?: string;
  review_decision_note?: string | null;
}

/** Pushes an admin edit back to intake. Only the columns sync_writer is granted — see schema.sql — are ever sent. */
export async function pushComplaintUpdate(id: string, patch: IntakeComplaintPatch): Promise<void> {
  await intakeFetch('sync_writer', 'complaints', {
    method: 'PATCH',
    query: `id=eq.${id}`,
    body: patch,
  });
}
