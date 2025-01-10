use anchor_lang::prelude::*;
use crate::{
    state::AuctionState,
    utils::{errors::BondingCurveError, events::AuctionInitialized},
};

#[derive(Accounts)]
#[instruction(base_price: u64, price_increment: u64, max_supply: u64)]
pub struct InitializeAuction<'info> {
    #[account(
        init,
        payer = payer,
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

    /// The authority who will manage the auction (doesn't need to be signer)
    /// CHECK: Just storing this pubkey
    #[account()]
    pub authority: AccountInfo<'info>,

    /// The account that will pay for the initialization
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Validated by Bubblegum program
    pub bubblegum_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeAuction>,
    base_price: u64,
    price_increment: u64,
    max_supply: u64,
    minimum_items: u64
) -> Result<()> {
    // Validate input parameters
    require!(base_price > 0, BondingCurveError::InvalidBasePrice);
    require!(price_increment > 0, BondingCurveError::InvalidPriceIncrement);
    require!(max_supply > 0, BondingCurveError::InvalidMaxSupply);
    require!(
        minimum_items > 0 && minimum_items <= max_supply,
        BondingCurveError::InvalidMinimumItems
    );

    // Validate merkle tree configuration
    require!(
        !ctx.accounts.merkle_tree.data_is_empty(),
        BondingCurveError::InvalidMerkleTree
    );

    // Validate authority
    require!(
        !ctx.accounts.authority.key().eq(&Pubkey::default()),
        BondingCurveError::InvalidAuthority
    );

    // Initialize auction state
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

    // Emit initialization event
    emit!(AuctionInitialized {
        auction: auction.key(),
        authority: ctx.accounts.authority.key(),
        merkle_tree: ctx.accounts.merkle_tree.key(),
        base_price,
        price_increment,
        max_supply,
        minimum_items,
    });

    Ok(())
} 