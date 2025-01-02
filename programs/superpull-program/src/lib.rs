use anchor_lang::prelude::*;

declare_id!("EDX7DLx7YwQFFMC9peZh5nDqiB4bKVpa2SpvSfwz4XUG");

#[program]
pub mod superpull_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }

    pub fn initialize_auction(
        ctx: Context<InitializeAuction>,
        base_price: u64,
        price_increment: u64,
        max_supply: u64,
    ) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        auction.authority = ctx.accounts.authority.key();
        auction.merkle_tree = ctx.accounts.merkle_tree.key();
        auction.base_price = base_price;
        auction.price_increment = price_increment;
        auction.current_supply = 0;
        auction.max_supply = max_supply;
        auction.total_value_locked = 0;
        Ok(())
    }

    pub fn get_current_price(ctx: Context<GetPrice>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let current_price = auction.base_price + 
            (auction.price_increment * auction.current_supply);
        
        // Emit an event with the current price
        emit!(PriceUpdate {
            auction: auction.key(),
            price: current_price,
            supply: auction.current_supply,
        });
        
        Ok(())
    }

    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        let current_price = {
            let auction = &ctx.accounts.auction;
            auction.base_price + (auction.price_increment * auction.current_supply)
        };
            
        require!(amount >= current_price, BondingCurveError::InsufficientBidAmount);
        require!(
            ctx.accounts.auction.current_supply < ctx.accounts.auction.max_supply, 
            BondingCurveError::MaxSupplyReached
        );

        // Transfer SOL from bidder to auction account
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.bidder.to_account_info(),
                to: ctx.accounts.auction.to_account_info(),
            },
        );
        
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Update auction state
        let auction = &mut ctx.accounts.auction;
        auction.current_supply = auction.current_supply.checked_add(1)
            .ok_or(BondingCurveError::MathOverflow)?;
        auction.total_value_locked = auction.total_value_locked.checked_add(amount)
            .ok_or(BondingCurveError::MathOverflow)?;

        // Emit bid event
        emit!(BidPlaced {
            auction: auction.key(),
            bidder: ctx.accounts.bidder.key(),
            amount,
            new_supply: auction.current_supply,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

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
    
    /// The merkle tree that contains the compressed NFT
    /// CHECK: Validated by Bubblegum program
    pub merkle_tree: AccountInfo<'info>,
    
    /// The authority who can manage the auction
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    pub auction: Account<'info, AuctionState>,
}

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub auction: Account<'info, AuctionState>,
    
    #[account(mut)]
    pub bidder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct AuctionState {
    pub authority: Pubkey,
    pub merkle_tree: Pubkey,
    pub base_price: u64,
    pub price_increment: u64,
    pub current_supply: u64,
    pub max_supply: u64,
    pub total_value_locked: u64,
}

impl AuctionState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // merkle_tree
        8 + // base_price
        8 + // price_increment
        8 + // current_supply
        8 + // max_supply
        8; // total_value_locked
}

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

#[error_code]
pub enum BondingCurveError {
    #[msg("Bid amount is less than current price")]
    InsufficientBidAmount,
    #[msg("Maximum supply reached")]
    MaxSupplyReached,
    #[msg("Math overflow")]
    MathOverflow,
}
