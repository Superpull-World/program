use anchor_lang::prelude::*;

declare_id!("6A6WedM2c3nne1oGVk9kpNjZHHqNGAf7P9B9aWHV4Hba");

pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

#[program]
pub mod superpull_program {
    use super::*;

    pub fn initialize_auction(
        ctx: Context<InitializeAuction>,
        base_price: u64,
        price_increment: u64,
        max_supply: u64,
        minimum_items: u64,
    ) -> Result<()> {
        initialize_auction_handler(ctx, base_price, price_increment, max_supply, minimum_items)
    }

    pub fn get_current_price(ctx: Context<GetCurrentPrice>) -> Result<()> {
        get_current_price_handler(ctx)
    }

    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        place_bid_handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        withdraw_handler(ctx)
    }
}
