// Per-farmer Stellar account key derivation.
//
// Seed phrases are stored in `users.stellar_mnemonic` encrypted at rest (see crypto.js).
// The decrypted mnemonic and the derived keypair's secret must never be logged or
// persisted anywhere — they are only ever held in local variables for the duration
// of signing a single transaction, then left to be garbage collected.
const bip39 = require('bip39');
const StellarHDWallet = require('stellar-hd-wallet');
const { StellarSdk } = require('./stellar-config');
const { decrypt } = require('./crypto');

/**
 * Decrypt an encrypted BIP39 mnemonic (as stored in users.stellar_mnemonic) and derive
 * the account's Stellar keypair from it.
 *
 * Never log the return value or its .secret() — it is a raw private key held in memory.
 *
 * @param {string} encryptedSeedPhrase - value produced by crypto.js#encrypt
 * @returns {import('@stellar/stellar-sdk').Keypair}
 */
function decryptAndDeriveKeypair(encryptedSeedPhrase) {
  if (!encryptedSeedPhrase) {
    throw new Error('decryptAndDeriveKeypair() requires an encrypted seed phrase');
  }

  let mnemonic;
  try {
    mnemonic = decrypt(encryptedSeedPhrase);
  } catch (e) {
    // Re-throw with a stellar-accounts-specific message; never include the raw payload.
    throw new Error(`Unable to decrypt Stellar seed phrase: ${e.message}`);
  }

  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Decrypted value is not a valid BIP39 mnemonic');
  }

  try {
    const wallet = StellarHDWallet.fromMnemonic(mnemonic);
    return StellarSdk.Keypair.fromSecret(wallet.getSecret(0));
  } finally {
    // Best-effort: drop the local reference so it isn't retained past this call.
    mnemonic = null;
  }
}

module.exports = { decryptAndDeriveKeypair };
