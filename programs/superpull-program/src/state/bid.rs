use anchor_lang::prelude::*;

#[account]
pub struct BidState {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

impl BidState {
    pub const LEN: usize = 8 +  // discriminator
        32 + // auction
        32 + // bidder
        8 +  // amount
        1;  // bump
} 