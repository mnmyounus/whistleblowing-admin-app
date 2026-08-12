import { SignJWT } from 'jose';

/**
 * Mints a short-lived JWT whose "role" claim names a scoped Postgres role
 * on the INTAKE project (sync_reader or sync_writer — see
 * public-app/supabase/schema.sql). PostgREST reads this claim and does
 * `SET ROLE` into it, so the token's holder gets exactly that role's
 * privileges — nothing more, regardless of what other credentials this
 * server has lying around.
 *
 * Signed with INTAKE_JWT_SECRET, which is the intake Supabase project's
 * own JWT secret (Settings → API → JWT Settings → JWT Secret on the
 * INTAKE project, not this one). This server never holds intake's
 * service_role key — only this narrow signing capability, which can only
 * ever produce tokens for the two roles PostgREST will actually honor.
 *
 * Short expiry (5 minutes) is deliberate: even if a minted token were
 * somehow captured mid-flight, it's useless shortly after.
 */
async function mintIntakeRoleToken(role: 'sync_reader' | 'sync_writer'): Promise<string> {
  const secret = process.env.INTAKE_JWT_SECRET;
  if (!secret) throw new Error('INTAKE_JWT_SECRET is not configured.');

  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

export function mintSyncReaderToken(): Promise<string> {
  return mintIntakeRoleToken('sync_reader');
}

export function mintSyncWriterToken(): Promise<string> {
  return mintIntakeRoleToken('sync_writer');
}
