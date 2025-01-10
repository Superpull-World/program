use anchor_lang::prelude::*;

#[error_code]
pub enum BondingCurveError {
    #[msg("Bid amount is less than current price")]
    InsufficientBidAmount,
    #[msg("Maximum supply reached")]
    MaxSupplyReached,
    #[msg("Math overflow")]
    MathOverflow,
} 