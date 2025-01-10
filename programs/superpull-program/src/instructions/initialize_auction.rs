use anchor_lang::prelude::*;
use crate::state::AuctionState;

#[derive(Accounts)]
#[instruction(base_price: u64, price_increment: u64, max_supply: u64)]
pub struct InitializeAuction<'info> {
    #[account(
        init,
        payer = authority,
        space = AuctionState::LEN,
        seeds = [
            b"auction",
            merkle_tree.key().as_ref(),
            authority.key().as_ref(),
        ],
        bump
    )]
    pub auction: Account<'info, AuctionState>,

    /// CHECK: Validated by Bubblegum program
    pub merkle_tree: AccountInfo<'info>,

    /// CHECK: Validate by program
    #[account(mut)]
    pub collection_mint: AccountInfo<'info>,

    /// The authority who can manage the auction
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Validated by Bubblegum program
    pub bubblegum_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeAuction>,
    base_price: u64,
    price_increment: u64,
    max_supply: u64,
    minimum_items: u64,
) -> Result<()> {
    let auction = &mut ctx.accounts.auction;
    auction.authority = ctx.accounts.authority.key();
    auction.merkle_tree = ctx.accounts.merkle_tree.key();
    auction.base_price = base_price;
    auction.price_increment = price_increment;
    auction.current_supply = 0;
    auction.max_supply = max_supply;
    auction.total_value_locked = 0;
    auction.minimum_items = minimum_items;
    auction.is_graduated = false;
    auction.bump = ctx.bumps.auction;

    Ok(())
} 