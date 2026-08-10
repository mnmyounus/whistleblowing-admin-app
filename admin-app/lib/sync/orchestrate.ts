import { fetchChangedComplaints, pushComplaintUpdate, type IntakeComplaintRow } from './intakeClient';
import { supabaseAdmin } from '../supabaseAdmin';

/**
 * Pulls everything that changed on intake since the last successful sync,
 * and writes it into the local cache (see admin-app/supabase/schema.sql).
 *
 * Conflict handling: a row that's `locally_dirty` (an admin edit here
 * hasn't been confirmed pushed to intake yet) is skipped on pull — we
 * don't want a pull to clobber an edit that just hasn't round-tripped
 * yet. In normal operation this window is seconds (pushLocalEdit below
 * pushes immediately, not on a batch timer), so skipping dirty rows for
 * one pull cycle is enough; the next pull picks them up once the push
 * clears the dirty flag.
 */
export async function pullFromIntake(): Promise<{ pulled: number; skippedDirty: number }> {
  const { data: state, error: stateError } = await supabaseAdmin
    .from('sync_state')
    .select('last_pulled_at')
    .single();
  if (stateError) throw new Error(`Could not read sync_state: ${stateError.message}`);

  let rows: IntakeComplaintRow[];
  try {
    rows = await fetchChangedComplaints(state.last_pulled_at);
  } catch (err) {
    await supabaseAdmin
      .from('sync_state')
      .update({ last_pull_ok: false, last_pull_error: err instanceof Error ? err.message : String(err) })
      .eq('id', true);
    throw err;
  }

  if (rows.length === 0) {
    await supabaseAdmin
      .from('sync_state')
      .update({ last_pulled_at: new Date().toISOString(), last_pull_ok: true, last_pull_error: null })
      .eq('id', true);
    return { pulled: 0, skippedDirty: 0 };
  }

  const { data: dirtyRows } = await supabaseAdmin
    .from('complaints')
    .select('id')
    .in('id', rows.map((r) => r.id))
    .eq('locally_dirty', true);
  const dirtyIds = new Set((dirtyRows ?? []).map((r) => r.id as string));

  const toUpsert = rows
    .filter((r) => !dirtyIds.has(r.id))
    .map((r) => ({
      id: r.id,
      tracking_code: r.tracking_code,
      channel: r.channel,
      status: r.status,
      encrypted_payload: r.encrypted_payload,
      encrypted_proof_path: r.encrypted_proof_path,
      encrypted_proof_key: r.encrypted_proof_key,
      admin_public_note: r.admin_public_note,
      admin_internal_notes: r.admin_internal_notes,
      review_status: r.review_status,
      review_statement: r.review_statement,
      review_decision_note: r.review_decision_note,
      intake_created_at: r.created_at,
      intake_updated_at: r.updated_at,
      synced_at: new Date().toISOString(),
      locally_dirty: false,
    }));

  if (toUpsert.length > 0) {
    const { error: upsertError } = await supabaseAdmin.from('complaints').upsert(toUpsert, { onConflict: 'id' });
    if (upsertError) throw new Error(`Could not upsert synced complaints: ${upsertError.message}`);
  }

  // Watermark advances to the newest updated_at actually seen, not "now" —
  // so a slow-to-arrive row with an older updated_at than wall-clock time
  // at pull-start still gets picked up correctly on the next run instead
  // of being skipped by an over-eager watermark.
  const newestSeen = rows[rows.length - 1].updated_at; // fetchChangedComplaints orders ascending
  await supabaseAdmin
    .from('sync_state')
    .update({ last_pulled_at: newestSeen, last_pull_ok: true, last_pull_error: null })
    .eq('id', true);

  return { pulled: toUpsert.length, skippedDirty: dirtyIds.size };
}

/**
 * Applies an admin edit locally (marking the row dirty), pushes it to
 * intake immediately, and clears the dirty flag only once intake confirms
 * the write. If the push fails, the row stays dirty and the edit stays
 * visible in the local cache — nothing is lost, but the dashboard should
 * surface that it hasn't round-tripped yet (see AdminPanel).
 */
export async function pushLocalEdit(
  id: string,
  patch: {
    status?: string;
    admin_public_note?: string | null;
    admin_internal_notes?: unknown;
    review_status?: string;
    review_decision_note?: string | null;
  }
): Promise<void> {
  const { error: localError } = await supabaseAdmin
    .from('complaints')
    .update({ ...patch, locally_dirty: true })
    .eq('id', id);
  if (localError) throw new Error(`Could not save edit locally: ${localError.message}`);

  await pushComplaintUpdate(id, patch); // throws on failure — row stays dirty, caller decides how to surface that

  const { error: clearError } = await supabaseAdmin.from('complaints').update({ locally_dirty: false }).eq('id', id);
  if (clearError) throw new Error(`Push succeeded but could not clear dirty flag: ${clearError.message}`);
}
