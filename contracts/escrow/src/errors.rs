use soroban_sdk::contracterror;

/// Typed error codes returned by the escrow contract.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum EscrowError {
    /// order_id (or another amount/size argument) is outside the accepted range.
    InvalidAmount = 1,
}
