use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::{
    state::AuctionState,
    utils::{errors::BondingCurveError, events::FundsWithdrawn},
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        has_one = authority @ BondingCurveError::UnauthorizedWithdraw,
    )]
    pub auction: Account<'info, AuctionState>,

    /// The authority who can authorize the withdrawal and receive the funds
    /// CHECK: Just checking against auction authority
    #[account(mut)]
    pub authority: AccountInfo<'info>,

    /// The authority's token account to receive the withdrawn tokens
    /// CHECK: Validated through token program CPI
    #[account(mut)]
    pub authority_token_account: AccountInfo<'info>,

    /// The auction's token account to withdraw from
    /// CHECK: Validated through token program CPI
    #[account(mut)]
    pub auction_token_account: AccountInfo<'info>,

    /// The account that will pay for the transaction
    #[account(mut, signer)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Validated through token program CPI
    pub token_program: AccountInfo<'info>,
}

pub fn withdraw_handler(ctx: Context<Withdraw>) -> Result<()> {
    let auction = &ctx.accounts.auction;
    
    // Validate auction state
    require!(
        auction.is_graduated,
        BondingCurveError::NotGraduated
    );

    // Validate authority
    require!(
        !ctx.accounts.authority.key().eq(&Pubkey::default()),
        BondingCurveError::InvalidAuthority
    );

    // Get the amount to withdraw
    let amount = auction.total_value_locked;
    require!(amount > 0, BondingCurveError::NoFundsToWithdraw);

    // Transfer tokens from auction account to authority account
    let seeds = &[
        b"auction",
        auction.merkle_tree.as_ref(),
        auction.authority.as_ref(),
        &[auction.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = token::Transfer {
        from: ctx.accounts.auction_token_account.to_account_info(),
        to: ctx.accounts.authority_token_account.to_account_info(),
        authority: ctx.accounts.auction.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer,
    );
    token::transfer(cpi_ctx, amount)?;

    // Update auction state
    let auction = &mut ctx.accounts.auction;
    auction.total_value_locked = 0;

    // Emit withdraw event
    emit!(FundsWithdrawn {
        auction: auction.key(),
        authority: ctx.accounts.authority.key(),
        amount,
    });

    Ok(())
} 