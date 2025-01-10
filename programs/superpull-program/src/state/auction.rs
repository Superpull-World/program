use anchor_lang::prelude::*;

#[account]
pub struct AuctionState {
    pub authority: Pubkey,
    pub merkle_tree: Pubkey,
    pub token_mint: Pubkey,
    pub base_price: u64,
    pub price_increment: u64,
    pub current_supply: u64,
    pub max_supply: u64,
    pub total_value_locked: u64,
    pub minimum_items: u64,
    pub is_graduated: bool,
    pub bump: u8,
}

impl AuctionState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // merkle_tree
        32 + // token_mint
        8 + // base_price
        8 + // price_increment
        8 + // current_supply
        8 + // max_supply
        8 + // total_value_locked
        8 + // minimum_items
        1 + // is_graduated
        1; // bump
} 