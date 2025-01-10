use anchor_lang::prelude::*;

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