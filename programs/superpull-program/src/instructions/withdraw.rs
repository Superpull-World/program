use anchor_lang::prelude::*;
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

    /// The account that will pay for the transaction
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>) -> Result<()> {
    let auction = &ctx.accounts.auction;
    
    // Check if auction has graduated
    require!(
        auction.is_graduated,
        BondingCurveError::NotGraduated
    );

    // Get the amount to withdraw
    let amount = auction.total_value_locked;
    require!(amount > 0, BondingCurveError::InsufficientBidAmount);

    // Get account infos
    let auction_info = ctx.accounts.auction.to_account_info();
    let authority_info = ctx.accounts.authority.to_account_info();

    // Calculate rent-exempt balance that needs to stay in the account
    let rent = Rent::get()?;
    let rent_exempt_balance = rent.minimum_balance(auction_info.data_len());
    
    // Get current balances
    let auction_balance = auction_info.lamports();
    let authority_balance = authority_info.lamports();

    // Verify we have enough lamports to withdraw while staying rent-exempt
    require!(
        auction_balance >= rent_exempt_balance + amount,
        BondingCurveError::InsufficientBidAmount
    );

    // Calculate the exact amount we can withdraw
    let withdraw_amount = auction_balance.checked_sub(rent_exempt_balance)
        .ok_or(BondingCurveError::MathOverflow)?;

    // Transfer lamports directly
    **auction_info.try_borrow_mut_lamports()? = auction_balance.checked_sub(withdraw_amount)
        .ok_or(BondingCurveError::MathOverflow)?;
    **authority_info.try_borrow_mut_lamports()? = authority_balance.checked_add(withdraw_amount)
        .ok_or(BondingCurveError::MathOverflow)?;

    // Update auction state
    let auction = &mut ctx.accounts.auction;
    auction.total_value_locked = 0;

    // Emit withdraw event
    emit!(FundsWithdrawn {
        auction: auction.key(),
        authority: ctx.accounts.authority.key(),
        amount: withdraw_amount,
    });

    Ok(())
} 