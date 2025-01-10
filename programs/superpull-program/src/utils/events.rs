use anchor_lang::prelude::*;

#[event]
pub struct AuctionInitialized {
    pub auction: Pubkey,
    pub authority: Pubkey,
    pub merkle_tree: Pubkey,
    pub token_mint: Pubkey,
    pub base_price: u64,
    pub price_increment: u64,
    pub max_supply: u64,
    pub minimum_items: u64,
    pub deadline: i64,
}

#[event]
pub struct PriceUpdate {
    pub auction: Pubkey,
    pub price: u64,
    pub supply: u64,
}

#[event]
pub struct BidPlaced {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub new_supply: u64,
}

#[event]
pub struct AuctionGraduated {
    pub auction: Pubkey,
    pub total_items: u64,
    pub total_value_locked: u64,
}

#[event]
pub struct FundsWithdrawn {
    pub auction: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
} 