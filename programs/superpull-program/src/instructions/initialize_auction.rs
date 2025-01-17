use anchor_lang::prelude::*;
use crate::{
    state::AuctionState,
    utils::{errors::SuperpullProgramError, events::AuctionInitialized},
};

// use mpl_bubblegum::instructions::{MintToCollectionV1Cpi}

#[derive(Accounts)]
#[instruction(base_price: u64, price_increment: u64, max_supply: u64)]
pub struct InitializeAuction<'info> {
    #[account(
        init,
        payer = payer,
        space = AuctionState::LEN,
        seeds = [
            b"auction",
            authority.key().as_ref(),
            collection_mint.key().as_ref(),
        ],
        bump
    )]
    pub auction: Account<'info, AuctionState>,

    /// CHECK: Validated by Bubblegum program
    pub merkle_tree: AccountInfo<'info>,

    /// CHECK: Validate by program
    #[account(mut)]
    pub collection_mint: AccountInfo<'info>,

    /// The mint of the token that will be accepted for payments
    /// CHECK: Just storing this pubkey
    pub token_mint: AccountInfo<'info>,

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

pub fn initialize_auction_handler(
    ctx: Context<InitializeAuction>,
    base_price: u64,
    price_increment: u64,
    max_supply: u64,
    minimum_items: u64,
    deadline: i64,
) -> Result<()> {
    // Validate input parameters
    require!(base_price > 0, SuperpullProgramError::InvalidBasePrice);
    require!(price_increment > 0, SuperpullProgramError::InvalidPriceIncrement);
    require!(max_supply > 0, SuperpullProgramError::InvalidMaxSupply);
    require!(
        minimum_items > 0 && minimum_items <= max_supply,
        SuperpullProgramError::InvalidMinimumItems
    );

    // Validate deadline is in the future
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        deadline > current_time,
        SuperpullProgramError::InvalidDeadline
    );

    // Validate merkle tree configuration
    require!(
        !ctx.accounts.merkle_tree.data_is_empty(),
        SuperpullProgramError::InvalidMerkleTree
    );

    // Validate authority
    require!(
        !ctx.accounts.authority.key().eq(&Pubkey::default()),
        SuperpullProgramError::InvalidAuthority
    );

    // Initialize auction state
    let auction = &mut ctx.accounts.auction;
    auction.authority = ctx.accounts.authority.key();
    auction.merkle_tree = ctx.accounts.merkle_tree.key();
    auction.token_mint = ctx.accounts.token_mint.key();
    auction.collection_mint = ctx.accounts.collection_mint.key();
    auction.base_price = base_price;
    auction.price_increment = price_increment;
    auction.current_supply = 0;
    auction.max_supply = max_supply;
    auction.total_value_locked = 0;
    auction.minimum_items = minimum_items;
    auction.deadline = deadline;
    auction.is_graduated = false;
    auction.bump = ctx.bumps.auction;

    // Emit initialization event
    emit!(AuctionInitialized {
        auction: auction.key(),
        authority: ctx.accounts.authority.key(),
        merkle_tree: ctx.accounts.merkle_tree.key(),
        token_mint: ctx.accounts.token_mint.key(),
        collection_mint: ctx.accounts.collection_mint.key(),
        base_price,
        price_increment,
        max_supply,
        minimum_items,
        deadline,
    });

    Ok(())
} 