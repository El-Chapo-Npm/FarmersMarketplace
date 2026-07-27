const router = require('express').Router();
const StellarSdk = require('@stellar/stellar-sdk');
const auth = require('../middleware/auth');
const db = require('../db/schema');
const config = require('../config');
const { simulateContractCall, invokeContract } = require('../utils/stellar');
const { err } = require('../middleware/error');

const STROOPS_PER_XLM = 10_000_000;

/**
 * Loads the farmer account associated with a Stellar address and verifies it
 * belongs to the authenticated caller. Returns the user row on success, or
 * sends an error response and returns null.
 */
async function requireOwnFarmerAccount(req, res, address) {
  const { rows } = await db.query(
    `SELECT id, stellar_public_key, stellar_secret_key FROM users WHERE stellar_public_key = $1 AND role = 'farmer'`,
    [address],
  );
  const farmer = rows[0];
  if (!farmer) {
    err(res, 404, 'No farmer account found for this address', 'farmer_not_found');
    return null;
  }
  if (farmer.id !== req.user.id) {
    err(res, 403, 'Access denied', 'forbidden');
    return null;
  }
  return farmer;
}

/**
 * @swagger
 * tags:
 *   name: Creator Earnings
 *   description: Query and claim earnings credited via the Creator Earnings Soroban contract
 */

/**
 * @swagger
 * /api/creator-earnings/{address}/balance:
 *   get:
 *     summary: Get a creator's current claimable balance
 *     tags: [Creator Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema: { type: string }
 *         description: Stellar public key of the creator (farmer)
 *     responses:
 *       200:
 *         description: Claimable balance
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     address: { type: string }
 *                     balance_xlm: { type: number }
 *       403:
 *         description: Address does not belong to the authenticated caller
 *       404:
 *         description: No farmer account found for this address
 */
router.get('/:address/balance', auth, async (req, res) => {
  const { address } = req.params;
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    return err(res, 400, 'Invalid Stellar address', 'invalid_address');
  }

  const farmer = await requireOwnFarmerAccount(req, res, address);
  if (!farmer) return;

  const contractId = config.sorobanCreatorEarningsContractId;
  if (!contractId) {
    return err(res, 503, 'Creator Earnings contract is not configured', 'contract_unconfigured');
  }

  try {
    const sim = await simulateContractCall(contractId, 'balance', [{ type: 'address', value: address }]);
    if (!sim.success) {
      return err(res, 502, `Failed to read balance: ${sim.error}`, 'rpc_error');
    }
    res.json({
      success: true,
      data: { address, balance_xlm: Number(sim.result || 0) / STROOPS_PER_XLM },
    });
  } catch (error) {
    err(res, 500, `Failed to fetch balance: ${error.message}`, 'rpc_error');
  }
});

/**
 * @swagger
 * /api/creator-earnings/{address}/lifetime:
 *   get:
 *     summary: Get a creator's lifetime (all-time) earnings
 *     tags: [Creator Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema: { type: string }
 *         description: Stellar public key of the creator (farmer)
 *     responses:
 *       200:
 *         description: Lifetime earnings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     address: { type: string }
 *                     lifetime_earned_xlm: { type: number }
 *       403:
 *         description: Address does not belong to the authenticated caller
 *       404:
 *         description: No farmer account found for this address
 */
router.get('/:address/lifetime', auth, async (req, res) => {
  const { address } = req.params;
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    return err(res, 400, 'Invalid Stellar address', 'invalid_address');
  }

  const farmer = await requireOwnFarmerAccount(req, res, address);
  if (!farmer) return;

  const contractId = config.sorobanCreatorEarningsContractId;
  if (!contractId) {
    return err(res, 503, 'Creator Earnings contract is not configured', 'contract_unconfigured');
  }

  try {
    const sim = await simulateContractCall(contractId, 'lifetime_earned', [{ type: 'address', value: address }]);
    if (!sim.success) {
      return err(res, 502, `Failed to read lifetime earnings: ${sim.error}`, 'rpc_error');
    }
    res.json({
      success: true,
      data: { address, lifetime_earned_xlm: Number(sim.result || 0) / STROOPS_PER_XLM },
    });
  } catch (error) {
    err(res, 500, `Failed to fetch lifetime earnings: ${error.message}`, 'rpc_error');
  }
});

/**
 * @swagger
 * /api/creator-earnings/{address}/claim:
 *   post:
 *     summary: Claim a creator's accumulated balance
 *     tags: [Creator Earnings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema: { type: string }
 *         description: Stellar public key of the creator (farmer)
 *     responses:
 *       200:
 *         description: Claim submitted and confirmed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 tx_hash: { type: string }
 *                 claimed_xlm: { type: number }
 *       403:
 *         description: Address does not belong to the authenticated caller
 *       404:
 *         description: No farmer account found for this address
 *       502:
 *         description: The claim transaction failed or could not be confirmed
 */
router.post('/:address/claim', auth, async (req, res) => {
  const { address } = req.params;
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    return err(res, 400, 'Invalid Stellar address', 'invalid_address');
  }

  const farmer = await requireOwnFarmerAccount(req, res, address);
  if (!farmer) return;

  const contractId = config.sorobanCreatorEarningsContractId;
  const tokenContractId = config.sorobanXlmTokenContractId;
  if (!contractId || !tokenContractId) {
    return err(res, 503, 'Creator Earnings contract is not configured', 'contract_unconfigured');
  }
  if (!farmer.stellar_secret_key) {
    return err(res, 400, 'No Stellar signing key on file for this account', 'no_key');
  }

  try {
    const { hash, result } = await invokeContract({
      contractId,
      method: 'claim',
      args: [
        { type: 'address', value: address },
        { type: 'address', value: tokenContractId },
      ],
      signerSecret: farmer.stellar_secret_key,
    });

    res.json({
      success: true,
      tx_hash: hash,
      claimed_xlm: Number(result || 0) / STROOPS_PER_XLM,
    });
  } catch (error) {
    err(res, 502, `Claim failed: ${error.message}`, 'claim_failed');
  }
});

module.exports = router;
