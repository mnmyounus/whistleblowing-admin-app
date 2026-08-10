/**
 * Zero-knowledge hybrid encryption utilities (Web Crypto API).
 *
 * Design: RSA-OAEP-2048 (admin keypair) + AES-256-GCM (per-item symmetric
 * key). RSA-OAEP alone can only encrypt ~190 bytes at a time (2048-bit
 * modulus, SHA-256 OAEP overhead), so every complaint / proof file / review
 * statement gets its own random AES-256 key, and THAT key is what gets
 * wrapped with the admin's RSA public key. This is the standard hybrid-
 * encryption pattern and lets us encrypt payloads of any size.
 *
 * Nothing in this file talks to a server. Every function here runs entirely
 * in the browser (or, for the encrypt-only path, in the admin's own
 * decrypted session when composing a note). Verified against a Node
 * Web-Crypto self-test before shipping — see the project notes.
 */

export interface EncryptedBlob {
  iv: string; // base64, 12 bytes
  ciphertext: string; // base64
}

export interface HybridEncryptedPayload {
  wrappedKey: string; // base64 — the AES key, encrypted with the admin's RSA-OAEP public key
  payload: EncryptedBlob; // AES-GCM encrypted content
}

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

// TypeScript's lib.dom types make Uint8Array generic over its backing
// buffer, and `new Uint8Array(n)` infers the wide ArrayBufferLike bound
// (which includes SharedArrayBuffer) rather than the narrower ArrayBuffer
// that crypto.subtle's BufferSource parameters require — constructing the
// ArrayBuffer explicitly first is what actually narrows the type (verified
// against tsc directly; an annotation alone does not). Every random byte
// array in this file goes through here so that stays true everywhere, not
// just at one call site.
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

// ---------- base64 helpers ----------
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------- admin keypair ----------

/** Run once, in the admin's browser, during first-time setup (see AdminDashboard). */
export async function generateAdminKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
}

export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', publicKey);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
}

export async function exportPrivateKeyJwk(privateKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', privateKey);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
}

// ---------- hybrid encrypt / decrypt ----------

/** Encrypts arbitrary UTF-8 text (e.g. JSON.stringify(complaintFields)) for the admin. */
export async function hybridEncryptText(
  plaintext: string,
  adminPublicKey: CryptoKey
): Promise<HybridEncryptedPayload> {
  return hybridEncryptBytes(new TextEncoder().encode(plaintext), adminPublicKey);
}

/** Encrypts arbitrary bytes (e.g. a proof image, after stripImageMetadata) for the admin. */
export async function hybridEncryptBytes(
  plaintext: BufferSource,
  adminPublicKey: CryptoKey
): Promise<HybridEncryptedPayload> {
  const rawAesKey = randomBytes(32); // AES-256
  const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = randomBytes(12); // 96-bit IV, the GCM-recommended size
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, adminPublicKey, rawAesKey);

  return {
    wrappedKey: bufToB64(wrappedKey),
    payload: { iv: bufToB64(iv.buffer), ciphertext: bufToB64(ciphertext) },
  };
}

/** Admin-side: decrypt back to UTF-8 text. */
export async function hybridDecryptText(
  encrypted: HybridEncryptedPayload,
  adminPrivateKey: CryptoKey
): Promise<string> {
  const bytes = await hybridDecryptBytes(encrypted, adminPrivateKey);
  return new TextDecoder().decode(bytes);
}

/** Admin-side: decrypt back to raw bytes (e.g. for a proof image). */
export async function hybridDecryptBytes(
  encrypted: HybridEncryptedPayload,
  adminPrivateKey: CryptoKey
): Promise<Uint8Array> {
  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    adminPrivateKey,
    b64ToBuf(encrypted.wrappedKey)
  );
  const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(encrypted.payload.iv) },
    aesKey,
    b64ToBuf(encrypted.payload.ciphertext)
  );
  return new Uint8Array(plaintext);
}

// ---------- passphrase-protected private key storage ----------
// The private key never leaves the admin's device. We still encrypt it at
// rest (IndexedDB, see AdminDashboard) behind a passphrase so a stolen or
// borrowed device isn't enough on its own to read past complaints. There is
// NO recovery path if both the device storage and the passphrase are lost —
// that's the tradeoff zero-knowledge design requires, not an oversight.

export interface EncryptedPrivateKeyBundle {
  salt: string; // base64, PBKDF2 salt
  iv: string; // base64
  ciphertext: string; // base64 — the private key JWK, AES-GCM encrypted
  iterations: number;
}

async function deriveKeyFromPassphrase(passphrase: string, salt: BufferSource, iterations: number) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const PBKDF2_ITERATIONS = 300_000;

/** Wrap the admin's private key behind a passphrase, ready to persist locally. */
export async function lockPrivateKeyWithPassphrase(
  privateKey: CryptoKey,
  passphrase: string
): Promise<EncryptedPrivateKeyBundle> {
  const jwk = await exportPrivateKeyJwk(privateKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(jwk))
  );
  return {
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ciphertext: bufToB64(ciphertext),
    iterations: PBKDF2_ITERATIONS,
  };
}

/** Unwrap the private key given the admin's passphrase. Throws (fails closed) on a wrong passphrase. */
export async function unlockPrivateKeyWithPassphrase(
  bundle: EncryptedPrivateKeyBundle,
  passphrase: string
): Promise<CryptoKey> {
  const salt = new Uint8Array(b64ToBuf(bundle.salt));
  const key = await deriveKeyFromPassphrase(passphrase, salt, bundle.iterations);
  const jwkBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(bundle.iv) },
    key,
    b64ToBuf(bundle.ciphertext)
  ); // throws if the passphrase is wrong — GCM's auth tag check fails closed
  const jwk = JSON.parse(new TextDecoder().decode(jwkBytes));
  return importPrivateKeyJwk(jwk);
}
