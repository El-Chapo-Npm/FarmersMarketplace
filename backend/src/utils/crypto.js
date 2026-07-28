// AES-256-GCM encryption for sensitive DB fields (e.g. Stellar seed phrases).
// Uses a dedicated DB_ENCRYPTION_KEY — never the JWT secret — so rotating auth
// tokens can't accidentally invalidate (or double as) at-rest encryption.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended nonce size for GCM
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const raw = process.env.DB_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('DB_ENCRYPTION_KEY is not configured');
  }
  // Accept a hex-encoded 32-byte key, or derive one from an arbitrary passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns a single string "iv:authTag:ciphertext" (all base64) for compact DB storage.
 */
function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.length) {
    throw new Error('encrypt() requires a non-empty string');
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypt a string produced by encrypt(). Raises a clear, specific error when the
 * configured DB_ENCRYPTION_KEY does not match the key used to encrypt the value —
 * GCM's auth tag check fails closed instead of returning silently-wrong plaintext.
 */
function decrypt(payload) {
  if (typeof payload !== 'string' || payload.split(':').length !== 3) {
    throw new Error('decrypt() requires a valid "iv:authTag:ciphertext" payload');
  }
  const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length in encrypted payload');
  }
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (e) {
    throw new Error(
      'Failed to decrypt value: DB_ENCRYPTION_KEY does not match the key used to encrypt it'
    );
  }
}

module.exports = { encrypt, decrypt };
/**
 * AES-256-GCM helpers for encrypting secrets at rest.
 *
 * The encryption key is derived from process.env.ENCRYPTION_SECRET via
 * scrypt so that the raw env value never has to be exactly 32 bytes.
 *
 * Stored format (hex): salt(16) | iv(12) | authTag(16) | ciphertext
 * This is self-contained — no external key-management table needed.
 */

const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 32 };

function getSecret() {
  const s = process.env.ENCRYPTION_SECRET;
  if (!s) throw new Error('ENCRYPTION_SECRET env variable is not set');
  return s;
}

function deriveKey(secret, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(
      secret,
      salt,
      SCRYPT_PARAMS.dkLen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  );
}

async function encrypt(plaintext) {
  const secret = getSecret();
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(secret, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: salt(16) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([salt, iv, tag, ct]).toString('hex');
}

async function decrypt(encryptedHex) {
  const secret = getSecret();
  const buf = Buffer.from(encryptedHex, 'hex');
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const ct = buf.subarray(44);
  const key = await deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct) + decipher.final('utf8');
}

/**
 * Returns true if the value looks like a plaintext Stellar secret key
 * (starts with 'S' and is 56 chars — standard Stellar strkey format).
 * Used by the migration to skip already-encrypted values.
 */
function isPlaintext(value) {
  return typeof value === 'string' && /^S[A-Z2-7]{55}$/.test(value);
}

module.exports = { encrypt, decrypt, isPlaintext };
