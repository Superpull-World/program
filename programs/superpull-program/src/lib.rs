use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::MintToCollectionV1Cpi;

mod instructions;
mod state;
mod utils;

use instructions::*;
use state::*;
use utils::*;

declare_id!("EDX7DLx7YwQFFMC9peZh5nDqiB4bKVpa2SpvSfwz4XUG");

#[program]
pub mod superpull_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn initialize_auction(
        ctx: Context<InitializeAuction>,
        base_price: u64,
        price_increment: u64,
        max_supply: u64,
        minimum_items: u64,
    ) -> Result<()> {
        instructions::initialize_auction::handler(ctx, base_price, price_increment, max_supply, minimum_items)
    }

    pub fn get_current_price(ctx: Context<GetPrice>) -> Result<()> {
        instructions::get_price::handler(ctx)
    }

    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        instructions::place_bid::handler(ctx, amount)
    }
}
