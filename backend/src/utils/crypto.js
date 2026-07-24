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
