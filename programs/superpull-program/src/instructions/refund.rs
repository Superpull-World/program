use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::{
    state::{AuctionState, BidState},
    utils::{errors::SuperpullProgramError, events::BidRefunded},
};

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub auction: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds = [
            b"bid",
            auction.key().as_ref(),
            bidder.key().as_ref(),
        ],
        bump = bid.bump,
        has_one = auction,
        has_one = bidder,
    )]
    pub bid: Account<'info, BidState>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    /// The bidder's token account to receive refund
    /// CHECK: Validated through token program CPI
    #[account(mut)]
    pub bidder_token_account: AccountInfo<'info>,

    /// The auction's token account to refund from
    /// CHECK: Validated through token program CPI
    #[account(mut)]
    pub auction_token_account: AccountInfo<'info>,

    /// CHECK: Validated by token program
    pub token_program: AccountInfo<'info>,

    /// CHECK: Validated by system program
    pub system_program: AccountInfo<'info>,
}

pub fn refund_handler(ctx: Context<Refund>) -> Result<()> {
    let auction = &ctx.accounts.auction;
    let bid = &ctx.accounts.bid;
    
    // Check if auction has expired and not graduated
    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time > auction.deadline && !auction.is_graduated,
        SuperpullProgramError::InvalidRefundAttempt
    );

    // Check if there's anything to refund
    require!(bid.amount > 0, SuperpullProgramError::NoFundsToRefund);

    msg!("TODO: Implement NFT burning");

    // Transfer tokens from auction account back to bidder
    let seeds = &[
        b"auction",
        auction.authority.as_ref(),
        auction.collection_mint.as_ref(),
        &[auction.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = token::Transfer {
        from: ctx.accounts.auction_token_account.to_account_info(),
        to: ctx.accounts.bidder_token_account.to_account_info(),
        authority: ctx.accounts.auction.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::transfer(cpi_ctx, bid.amount)?;

    // Update auction state
    let auction = &mut ctx.accounts.auction;
    auction.total_value_locked = auction.total_value_locked
        .checked_sub(bid.amount)
        .ok_or(SuperpullProgramError::MathOverflow)?;

    // Update bid state
    let bid = &mut ctx.accounts.bid;
    let refunded_amount = bid.amount;
    bid.amount = 0;

    // Emit refund event
    emit!(BidRefunded {
        auction: auction.key(),
        bidder: ctx.accounts.bidder.key(),
        amount: refunded_amount,
    });

    Ok(())
}
