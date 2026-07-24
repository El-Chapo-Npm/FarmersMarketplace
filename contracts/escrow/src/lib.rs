#![no_std]

mod errors;

use errors::EscrowError;
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

// Backend order IDs are auto-incrementing DB primary keys; in practice they never
// approach this bound. Rejecting anything larger guards against malformed/overflowed
// caller input reaching contract storage.
const MAX_ORDER_ID: u64 = 1_000_000_000_000;

// TTL bump applied to escrow storage entries on every write so records don't get
// archived between deposit and release/refund/dispute (in ledgers, ~5s each):
// ~6 days threshold, ~30 days bump.
const BUMP_THRESHOLD: u32 = 100_000;
const BUMP_AMOUNT: u32 = 500_000;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Escrow(u64),
}

#[derive(Clone)]
#[contracttype]
pub struct Escrow {
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub released: bool,
    pub refunded: bool,
    pub disputed: bool,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn deposit(
        env: Env,
        xlm_token: Address,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
    ) -> Result<(), EscrowError> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if order_id >= MAX_ORDER_ID {
            return Err(EscrowError::InvalidAmount);
        }

        let key = DataKey::Escrow(order_id);
        if env.storage().persistent().has(&key) {
            panic!("escrow already exists");
        }

        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount,
            timeout_unix,
            released: false,
            refunded: false,
            disputed: false,
        };

        // Effects before interactions: the escrow record is written before the token
        // transfer below so a reentrant deposit() for the same order_id (triggered by
        // a malicious token/callback during the transfer) sees `has(&key) == true` and
        // is rejected, instead of racing past the check above.
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        Ok(())
    }

    pub fn release(env: Env, xlm_token: Address, order_id: u64) {
        let key = DataKey::Escrow(order_id);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");

        escrow.buyer.require_auth();
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }
        if escrow.disputed {
            panic!("escrow is in dispute");
        }

        // Effects before interactions: mark released before transferring funds so a
        // reentrant release()/refund() call during the transfer sees the updated
        // state and is blocked by the checks above.
        escrow.released = true;
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);
    }

    pub fn refund(env: Env, xlm_token: Address, order_id: u64) {
        let key = DataKey::Escrow(order_id);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");

        escrow.buyer.require_auth();
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }
        if env.ledger().timestamp() < escrow.timeout_unix {
            panic!("refund timeout has not passed");
        }

        // Effects before interactions — see release() above.
        escrow.refunded = true;
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);
    }

    pub fn dispute(env: Env, order_id: u64, caller: Address) {
        caller.require_auth();
        let key = DataKey::Escrow(order_id);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");

        if caller != escrow.buyer && caller != escrow.farmer {
            panic!("caller is not part of this escrow");
        }
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }

        escrow.disputed = true;
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    pub fn get(env: Env, order_id: u64) -> Escrow {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn dispute_marks_escrow() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);

        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            released: false,
            refunded: false,
            disputed: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(1), &escrow);

        EscrowContract::dispute(env.clone(), 1, buyer);
        let updated = EscrowContract::get(env, 1);
        assert!(updated.disputed);
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);

        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            amount: 1_000_0000,
            timeout_unix: 1_000,
            released: false,
            refunded: false,
            disputed: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(2), &escrow);

        let stored = EscrowContract::get(env, 2);
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    }

    #[test]
    fn deposit_rejects_order_id_over_max() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        let err = EscrowContract::deposit(
            env,
            token,
            MAX_ORDER_ID,
            buyer,
            farmer,
            100,
            1_000,
        )
        .unwrap_err();
        assert_eq!(err, EscrowError::InvalidAmount);
    }
}
