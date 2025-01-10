use anchor_lang::prelude::*;
use crate::{state::AuctionState, utils::events::PriceUpdate};

#[derive(Accounts)]
pub struct GetCurrentPrice<'info> {
    pub auction: Account<'info, AuctionState>,
}

pub fn get_current_price_handler(ctx: Context<GetCurrentPrice>) -> Result<()> {
    let auction = &ctx.accounts.auction;
    let current_price = auction.base_price + (auction.price_increment * auction.current_supply);

    // Emit an event with the current price
    emit!(PriceUpdate {
        auction: auction.key(),
        price: current_price,
        supply: auction.current_supply,
    });

    Ok(())
} 