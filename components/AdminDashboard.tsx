'use client';

import { useEffect, useState } from 'react';
import {
  generateAdminKeypair,
  exportPublicKeyJwk,
  lockPrivateKeyWithPassphrase,
  unlockPrivateKeyWithPassphrase,
  hybridDecryptText,
  hybridEncryptText,
  importPublicKeyJwk,
  type EncryptedPrivateKeyBundle,
  type HybridEncryptedPayload,
} from '@/lib/crypto/hybrid';
import { KeyRound, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

const DB_NAME = 'whistleblower-admin';
const STORE = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    tx.onsuccess = () => resolve(tx.result);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

interface AdminComplaint {
  id: string;
  tracking_code: string;
  channel: string;
  status: string;
  encrypted_payload: HybridEncryptedPayload;
  admin_public_note: string | null;
  admin_internal_notes: HybridEncryptedPayload | null;
  review_status: string;
  review_statement: HybridEncryptedPayload | null;
  intake_created_at: string;
  locally_dirty: boolean; // true = an edit here hasn't been confirmed pushed to intake yet
}

export function AdminDashboard() {
  const [adminToken, setAdminToken] = useState('');
  const [tokenConfirmed, setTokenConfirmed] = useState(false);
  const [bundle, setBundle] = useState<EncryptedPrivateKeyBundle | null | undefined>(undefined);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);

  useEffect(() => {
    idbGet<EncryptedPrivateKeyBundle>('privateKeyBundle').then((b) => setBundle(b ?? null));
  }, []);

  if (!tokenConfirmed) {
    return (
      <AdminTokenGate
        onConfirm={(token) => {
          setAdminToken(token);
          setTokenConfirmed(true);
        }}
      />
    );
  }
  if (bundle === undefined) return <Loader2 className="h-5 w-5 animate-spin text-muted" />;
  if (!privateKey) {
    return bundle === null ? (
      <AdminSetup
        onKeyReady={async (key, newBundle) => {
          await idbSet('privateKeyBundle', newBundle);
          setBundle(newBundle);
          setPrivateKey(key);
        }}
      />
    ) : (
      <AdminUnlock bundle={bundle} onUnlocked={setPrivateKey} />
    );
  }
  return <AdminPanel privateKey={privateKey} adminToken={adminToken} />;
}

function AdminTokenGate({ onConfirm }: { onConfirm: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="mx-auto max-w-sm space-y-3 pt-12 text-center">
      <KeyRound className="mx-auto h-8 w-8 text-muted" />
      <p className="text-sm text-muted">Admin access token</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg border border-line p-2 text-center"
        onKeyDown={(e) => e.key === 'Enter' && value && onConfirm(value)}
      />
      <button onClick={() => value && onConfirm(value)} className="w-full rounded-lg bg-seal py-2 text-white">
        Continue
      </button>
      <p className="text-xs text-muted">
        Second factor behind the IP allowlist — separate from your decryption passphrase below.
      </p>
    </div>
  );
}

function AdminSetup({ onKeyReady }: { onKeyReady: (key: CryptoKey, bundle: EncryptedPrivateKeyBundle) => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [publicJwk, setPublicJwk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (passphrase.length < 12 || passphrase !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const { publicKey, privateKey } = await generateAdminKeypair();
      const bundle = await lockPrivateKeyWithPassphrase(privateKey, passphrase);
      const jwk = await exportPublicKeyJwk(publicKey);
      setPublicJwk(JSON.stringify(jwk));
      // onKeyReady writes to IndexedDB (see AdminDashboard) — if THAT throws
      // (storage quota, private-browsing restrictions, etc.), the JWK above
      // has already been generated and shown, so it isn't lost even if the
      // save-locally step fails; the error below tells you specifically
      // that part didn't complete.
      await onKeyReady(privateKey, bundle);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not generate or save the key: ${e.message}`
          : 'Could not generate or save the key — unknown error.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pt-8">
      <h2 className="font-serif text-lg font-semibold">First-time setup: generate your admin key</h2>
      <p className="text-sm text-muted">
        Runs entirely in this browser. The private key never leaves this device — losing both this
        browser's storage <em>and</em> your passphrase means old complaints can never be decrypted again,
        by anyone. Back up the encrypted bundle printed below somewhere safe right after this step.
      </p>
      <input
        type="password"
        placeholder="Choose a passphrase (12+ characters)"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        className="w-full rounded-lg border border-line p-2"
      />
      <input
        type="password"
        placeholder="Confirm passphrase"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full rounded-lg border border-line p-2"
      />
      <button
        onClick={create}
        disabled={busy || passphrase.length < 12 || passphrase !== confirm}
        className="w-full rounded-lg bg-seal py-2 text-white disabled:opacity-40"
      >
        {busy ? 'Generating…' : 'Generate keypair'}
      </button>
      {error && <p className="text-sm text-flag">{error}</p>}
      {publicJwk && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-2 font-medium">
            Copy this into <b>both</b> apps' NEXT_PUBLIC_ADMIN_PUBLIC_KEY_JWK (public-app AND this admin
            app) and redeploy both — the public site needs it to encrypt submissions to you, and this app
            needs it for Manual Entry:
          </p>
          <textarea readOnly value={publicJwk} rows={4} className="w-full rounded border border-amber-300 p-2 font-mono text-xs" />
        </div>
      )}
    </div>
  );
}

function AdminUnlock({ bundle, onUnlocked }: { bundle: EncryptedPrivateKeyBundle; onUnlocked: (key: CryptoKey) => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await unlockPrivateKeyWithPassphrase(bundle, passphrase));
    } catch {
      setError('Wrong passphrase, or this bundle is corrupted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-3 pt-12 text-center">
      <KeyRound className="mx-auto h-8 w-8 text-muted" />
      <p className="text-sm text-muted">Enter your passphrase to unlock complaint decryption</p>
      <input
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && unlock()}
        className="w-full rounded-lg border border-line p-2 text-center"
      />
      {error && <p className="text-sm text-flag">{error}</p>}
      <button onClick={unlock} disabled={busy || !passphrase} className="w-full rounded-lg bg-seal py-2 text-white disabled:opacity-40">
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </div>
  );
}

const STATUS_OPTIONS = ['submitted', 'under_review', 'escalated', 'resolved', 'rejected', 'rejected_final'];

function AdminPanel({ privateKey, adminToken }: { privateKey: CryptoKey; adminToken: string }) {
  const [complaints, setComplaints] = useState<AdminComplaint[]>([]);
  const [selected, setSelected] = useState<AdminComplaint | null>(null);
  const [decrypted, setDecrypted] = useState<Record<string, unknown> | null>(null);
  const [reviewStatement, setReviewStatement] = useState<string | null>(null);
  const [internalNotes, setInternalNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  async function loadComplaints() {
    setLoading(true);
    const res = await fetch('/api/complaints', { headers: { Authorization: `Bearer ${adminToken}` } });
    if (res.ok) setComplaints((await res.json()).complaints);
    setLoading(false);
  }

  async function syncNow() {
    setSyncing(true);
    await fetch('/api/sync', { headers: { Authorization: `Bearer ${adminToken}` } }).catch(() => {});
    await loadComplaints();
    setSyncing(false);
  }

  useEffect(() => {
    loadComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openComplaint(c: AdminComplaint) {
    setSelected(c);
    setDecrypted(null);
    setReviewStatement(null);
    setInternalNotes('');
    const json = await hybridDecryptText(c.encrypted_payload, privateKey);
    setDecrypted(JSON.parse(json));
    if (c.review_statement) setReviewStatement(await hybridDecryptText(c.review_statement, privateKey));
    if (c.admin_internal_notes) setInternalNotes(await hybridDecryptText(c.admin_internal_notes, privateKey));
  }

  async function updateComplaint(patch: Record<string, unknown>) {
    if (!selected) return;
    setPushError(null);
    const res = await fetch(`/api/complaints/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await loadComplaints();
      setSelected((s) => (s ? { ...s, ...patch, locally_dirty: false } : s));
    } else {
      const body = await res.json().catch(() => ({}));
      setPushError(
        body.savedLocallyButNotPushed
          ? "Saved here, but couldn't reach intake yet — it'll retry. Your edit isn't lost."
          : 'Could not save this change.'
      );
      setSelected((s) => (s ? { ...s, ...patch, locally_dirty: true } : s));
    }
  }

  async function saveInternalNote(note: string) {
    const jwk = JSON.parse(process.env.NEXT_PUBLIC_ADMIN_PUBLIC_KEY_JWK ?? 'null');
    if (!jwk) return;
    const key = await importPublicKeyJwk(jwk);
    await updateComplaint({ admin_internal_notes: await hybridEncryptText(note, key) });
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
      <div className="space-y-1 md:border-r md:border-line md:pr-4">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => setShowManualEntry((v) => !v)} className="text-xs text-seal underline">
            {showManualEntry ? 'Hide manual entry' : '+ Manual entry'}
          </button>
          <button onClick={syncNow} disabled={syncing} className="flex items-center gap-1 text-xs text-muted disabled:opacity-40">
            <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} /> Sync
          </button>
        </div>
        {showManualEntry && <ManualEntryPanel onRegistered={loadComplaints} />}

        <p className="mb-2 text-sm font-medium text-muted">{loading ? 'Loading…' : `${complaints.length} complaints`}</p>
        {complaints.map((c) => (
          <button
            key={c.id}
            onClick={() => openComplaint(c)}
            className={`block w-full rounded-lg p-2 text-left text-sm ${
              selected?.id === c.id ? 'bg-ink text-paper' : 'hover:bg-paper'
            }`}
          >
            <p className="flex items-center gap-1 font-mono text-xs">
              {c.tracking_code}
              {c.locally_dirty && <AlertTriangle className="h-3 w-3 text-amber-500" aria-label="Not yet synced to intake" />}
            </p>
            <p className="capitalize">{c.status.replace('_', ' ')}</p>
          </button>
        ))}
      </div>

      <div>
        {!selected && <p className="text-sm text-muted">Select a complaint to decrypt and review it.</p>}
        {selected && !decrypted && <Loader2 className="h-5 w-5 animate-spin text-muted" />}
        {selected && decrypted && (
          <div className="space-y-4">
            {pushError && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">{pushError}</p>
            )}
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: (decrypted.description as string) ?? '' }} />
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">Target</dt>
              <dd>{decrypted.target as string}</dd>
              <dt className="text-muted">Incident date</dt>
              <dd>{decrypted.incidentDate as string} {(decrypted.incidentTime as string) ?? ''}</dd>
              {!!decrypted.clues && (<><dt className="text-muted">Clues</dt><dd>{decrypted.clues as string}</dd></>)}
              {!!decrypted.contactEmail && (<><dt className="text-muted">Contact</dt><dd>{decrypted.contactEmail as string}</dd></>)}
            </dl>

            {reviewStatement && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="mb-1 font-medium">Review request statement</p>
                <p>{reviewStatement}</p>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-line pt-3">
              <label className="text-sm text-muted">Status</label>
              <select value={selected.status} onChange={(e) => updateComplaint({ status: e.target.value })} className="rounded-lg border border-line p-1.5 text-sm">
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted">Public note (visible to the complainant)</label>
              <textarea defaultValue={selected.admin_public_note ?? ''} onBlur={(e) => updateComplaint({ admin_public_note: e.target.value })} rows={2} className="w-full rounded-lg border border-line p-2 text-sm" />
            </div>

            <div>
              <label className="mb-1 block text-sm text-muted">Internal notes (admin-only, encrypted)</label>
              <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} onBlur={() => saveInternalNote(internalNotes)} rows={3} className="w-full rounded-lg border border-line p-2 text-sm" />
            </div>

            {selected.review_status === 'requested' && (
              <div>
                <label className="mb-1 block text-sm text-muted">Final review decision note</label>
                <textarea
                  onBlur={(e) => updateComplaint({ review_decision_note: e.target.value, review_status: 'decided', status: 'rejected_final' })}
                  rows={2}
                  className="w-full rounded-lg border border-line p-2 text-sm"
                  placeholder="This is the ONE decision they'll see — status moves to Rejected (Final) automatically."
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ManualEntryPanel({ onRegistered }: { onRegistered: () => void }) {
  const [trackingCode, setTrackingCode] = useState('');
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [errorDetail, setErrorDetail] = useState('');

  async function activate() {
    setStatus('busy');
    setErrorDetail('');
    try {
      const jwk = JSON.parse(process.env.NEXT_PUBLIC_ADMIN_PUBLIC_KEY_JWK ?? 'null');
      const key = await importPublicKeyJwk(jwk);
      const encryptedPayload = await hybridEncryptText(
        JSON.stringify({ description: text, target, incidentDate: null, transcribedManually: true }),
        key
      );
      // Note: this hits the PUBLIC app's /api/postal PATCH endpoint
      // (intake owns postal_codes activation), not this admin app —
      // configured via NEXT_PUBLIC_PUBLIC_APP_URL, guarded by
      // NEXT_PUBLIC_PUBLIC_APP_MANUAL_ENTRY_TOKEN matching that route's
      // MANUAL_ENTRY_TOKEN. This is a browser-to-browser-facing-server
      // call, not a call through the sync bridge — it doesn't touch
      // sync_reader/sync_writer at all, since it's writing new content
      // to intake directly, the same way a real complainant's browser
      // does when they submit.
      const res = await fetch(`${process.env.NEXT_PUBLIC_PUBLIC_APP_URL}/api/postal`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_PUBLIC_APP_MANUAL_ENTRY_TOKEN ?? ''}`,
        },
        body: JSON.stringify({ trackingCode: trackingCode.trim().toUpperCase(), encryptedPayload }),
      });
      if (res.ok) {
        setStatus('done');
        setTrackingCode('');
        setTarget('');
        setText('');
        onRegistered();
      } else {
        setStatus('error');
        setErrorDetail((await res.json().catch(() => ({}))).error ?? '');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm font-medium">Manual entry</p>
      <p className="text-xs text-muted">For a letter, or a chat/email message a complainant sent directly to you.</p>
      <input value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} placeholder="Tracking code from the letter/message" className="w-full rounded border border-line p-1.5 text-sm font-mono" />
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Who/what it's about" className="w-full rounded border border-line p-1.5 text-sm" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Transcribed complaint text" rows={4} className="w-full rounded border border-line p-1.5 text-sm" />
      <button onClick={activate} disabled={status === 'busy' || !trackingCode || !text} className="rounded-lg bg-seal px-3 py-1.5 text-sm text-white disabled:opacity-40">
        {status === 'busy' ? 'Encrypting & saving…' : 'Register complaint'}
      </button>
      {status === 'done' && <p className="text-sm text-moss">Registered — it'll appear here after the next sync.</p>}
      {status === 'error' && <p className="text-sm text-flag">Could not register{errorDetail ? `: ${errorDetail}` : ''}.</p>}
    </div>
  );
}
