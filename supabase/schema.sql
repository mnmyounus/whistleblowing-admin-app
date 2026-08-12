-- ============================================================================
-- Anonymous Whistleblowing & Complaint System — ADMIN database schema
-- ============================================================================
-- This is a SEPARATE Supabase project from the intake DB (see
-- public-app/supabase/schema.sql). It never receives direct traffic from
-- the public internet — only from this app's own Vercel deployment, which
-- itself sits behind an IP allowlist (see README).
--
-- What lives here is a LOCAL CACHE of what the sync job pulled from
-- intake via sync_reader, plus whatever local-only state the dashboard
-- needs (currently none — every field the admin acts on already exists
-- on the intake side and gets written back via sync_writer). Losing this
-- database entirely and re-running the sync from scratch would rebuild
-- it losslessly, EXCEPT for admin_internal_notes and admin_public_note
-- values that hadn't been pushed back to intake yet — see the sync
-- route's comments for exactly how that race is handled.
--
-- Same zero-knowledge property holds here as everywhere else: this cache
-- holds exactly the same ciphertext the intake DB holds, nothing more.
-- Compromising this database instead of the intake one gains an attacker
-- nothing extra — the plaintext-unlocking capability was never stored in
-- either place.
-- ============================================================================

create extension if not exists pgcrypto;

create type complaint_status as enum (
  'submitted', 'under_review', 'escalated', 'resolved', 'rejected', 'rejected_final'
);
create type complaint_channel as enum ('web', 'postal');
create type review_status as enum ('none', 'requested', 'decided');

-- ---------------------------------------------------------------------------
-- COMPLAINTS CACHE — mirrors the columns sync_reader can see on intake.
-- id here is the SAME id as on intake (not regenerated), so a complaint
-- has one identity across both databases and the sync job can match rows
-- unambiguously.
-- ---------------------------------------------------------------------------
create table complaints (
  id uuid primary key, -- matches intake's complaints.id exactly
  tracking_code text not null unique,
  channel complaint_channel not null,
  status complaint_status not null,
  encrypted_payload jsonb not null,
  encrypted_proof_path text,
  encrypted_proof_key jsonb,
  admin_public_note text,
  admin_internal_notes jsonb,
  review_status review_status not null,
  review_statement jsonb,
  review_decision_note text,

  intake_created_at timestamptz not null, -- created_at from the intake row
  intake_updated_at timestamptz not null, -- updated_at from the intake row, used to detect changes on the next pull

  -- Local-only bookkeeping — never sent back to intake.
  synced_at timestamptz not null default now(), -- when THIS cache row was last refreshed from intake
  locally_dirty boolean not null default false -- true between "admin edited this" and "push confirmed intake accepted it"
);

create index complaints_status_idx on complaints (status);
create index complaints_locally_dirty_idx on complaints (locally_dirty) where locally_dirty;

-- ---------------------------------------------------------------------------
-- SYNC WATERMARK — one row, tracks the last successful pull so each sync
-- run only asks intake for rows changed since then, instead of the whole
-- table every time.
-- ---------------------------------------------------------------------------
create table sync_state (
  id boolean primary key default true, -- singleton row trick: only 'true' is ever inserted
  last_pulled_at timestamptz not null default '1970-01-01',
  last_pull_ok boolean not null default true,
  last_pull_error text,
  constraint sync_state_singleton check (id)
);
insert into sync_state (id) values (true);

-- ---------------------------------------------------------------------------
-- ADMIN AUTH — who's allowed to use this dashboard at all. Separate from
-- the RSA passphrase, which gates DECRYPTION specifically; this gates
-- reaching the dashboard UI/API in the first place. Kept intentionally
-- minimal for a single admin — see README for what to add before more
-- than one person needs an account.
-- ---------------------------------------------------------------------------
alter table complaints enable row level security;
alter table sync_state enable row level security;
-- No policies for anon/authenticated on either table — only this app's
-- own service role (server-side, bypasses RLS) ever touches this database.
-- There is deliberately no equivalent of sync_reader/sync_writer here:
-- nothing outside this app's own server should ever read or write this
-- cache directly, since unlike intake, this database's normal operator
-- (the admin app) IS the trusted party, not an external bridge.
