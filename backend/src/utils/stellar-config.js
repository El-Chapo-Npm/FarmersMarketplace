// Shared Stellar network configuration for account/key-derivation utilities.
// Kept separate from stellar.js so key-management code (stellar-accounts.js)
// does not need to pull in the full payments/escrow module surface.
const StellarSdk = require('@stellar/stellar-sdk');

const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();

if (!['testnet', 'mainnet'].includes(STELLAR_NETWORK)) {
  throw new Error(`Invalid STELLAR_NETWORK "${STELLAR_NETWORK}". Must be "testnet" or "mainnet".`);
}

const isTestnet = STELLAR_NETWORK === 'testnet';

const horizonUrl =
  process.env.STELLAR_HORIZON_URL ||
  (isTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');

const sorobanRpcUrl =
  process.env.SOROBAN_RPC_URL ||
  (isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org');

const networkPassphrase = isTestnet ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
const server = new StellarSdk.Horizon.Server(horizonUrl);

module.exports = {
  StellarSdk,
  STELLAR_NETWORK,
  isTestnet,
  horizonUrl,
  sorobanRpcUrl,
  networkPassphrase,
  server,
};
