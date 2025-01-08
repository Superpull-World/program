use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::MintToCollectionV1Cpi;
declare_id!("EDX7DLx7YwQFFMC9peZh5nDqiB4bKVpa2SpvSfwz4XUG");

#[program]
pub mod superpull_program {
    use mpl_bubblegum::{
        instructions::{
            MintToCollectionV1CpiAccounts, MintToCollectionV1InstructionArgs,
        },
        types::{MetadataArgs, TokenProgramVersion, TokenStandard},
    };

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

        Ok(())
    }

    pub fn get_current_price(ctx: Context<GetPrice>) -> Result<()> {
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

    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        let current_price = {
            let auction = &ctx.accounts.auction;
            auction.base_price + (auction.price_increment * auction.current_supply)
        };

        require!(
            amount >= current_price,
            BondingCurveError::InsufficientBidAmount
        );
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
        auction.current_supply = auction
            .current_supply
            .checked_add(1)
            .ok_or(BondingCurveError::MathOverflow)?;
        auction.total_value_locked = auction
            .total_value_locked
            .checked_add(amount)
            .ok_or(BondingCurveError::MathOverflow)?;

        // Check if auction has graduated
        if !auction.is_graduated && auction.current_supply >= auction.minimum_items {
            auction.is_graduated = true;
            emit!(AuctionGraduated {
                auction: auction.key(),
                total_items: auction.current_supply,
                total_value_locked: auction.total_value_locked,
            });
        }

        // Create bindings for all account_infos to extend their lifetimes
        let bubblegum_program = ctx.accounts.bubblegum_program.to_account_info();
        let tree_config = ctx.accounts.tree_config.to_account_info();
        let bidder = ctx.accounts.bidder.to_account_info();
        let merkle_tree = ctx.accounts.merkle_tree.to_account_info();
        let payer = ctx.accounts.payer.to_account_info();
        let auction_account = auction.to_account_info();
        let collection_mint = ctx.accounts.collection_mint.to_account_info();
        let collection_metadata = ctx.accounts.collection_metadata.to_account_info();
        let collection_edition = ctx.accounts.collection_edition.to_account_info();
        let log_wrapper = ctx.accounts.log_wrapper.to_account_info();
        let compression_program = ctx.accounts.compression_program.to_account_info();
        let token_metadata_program = ctx.accounts.token_metadata_program.to_account_info();
        let system_program = ctx.accounts.system_program.to_account_info();

        // Initialize CPI
        let mint_to_collection_cpi = MintToCollectionV1Cpi::new(
            bubblegum_program.as_ref(),
            MintToCollectionV1CpiAccounts {
                tree_config: tree_config.as_ref(),
                leaf_owner: bidder.as_ref(),
                leaf_delegate: bidder.as_ref(),
                merkle_tree: &merkle_tree,
                payer: payer.as_ref(),
                tree_creator_or_delegate: auction_account.as_ref(),
                collection_authority: auction_account.as_ref(),
                collection_mint: collection_mint.as_ref(),
                collection_authority_record_pda: Some(bubblegum_program.as_ref()),
                collection_metadata: collection_metadata.as_ref(),
                collection_edition: collection_edition.as_ref(),
                bubblegum_signer: auction_account.as_ref(),
                log_wrapper: log_wrapper.as_ref(),
                compression_program: compression_program.as_ref(),
                token_metadata_program: &token_metadata_program,
                system_program: &system_program,
            },
            MintToCollectionV1InstructionArgs {
                metadata: MetadataArgs {
                    name: "SuperPull NFT".to_string(),
                    symbol: "SPULL".to_string(),
                    uri: "https://assets.superpull.world/nft.json".to_string(),
                    seller_fee_basis_points: 0,
                    creators: vec![],
                    primary_sale_happened: false,
                    is_mutable: false,
                    collection: None,
                    uses: None,
                    edition_nonce: None,
                    token_standard: Some(TokenStandard::NonFungible),
                    token_program_version: TokenProgramVersion::Token2022,
                },
            },
        );

        // Define signer seeds
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"auction",
            auction.merkle_tree.as_ref(),
            auction.authority.as_ref(),
            &[auction.bump],
        ]];

        // Invoke CPI with signed seeds
        mint_to_collection_cpi.invoke_signed(signer_seeds)?;

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

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Validated by Bubblegum program
    pub collection_mint: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    pub collection_metadata: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    pub collection_edition: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    pub merkle_tree: AccountInfo<'info>,
    /// CHECK: Validated by Bubblegum program
    pub tree_config: AccountInfo<'info>,
    /// CHECK: Validated by Bubblegum program
    pub tree_creator: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    pub token_metadata_program: AccountInfo<'info>,
    /// CHECK: Validated by Compression program
    pub compression_program: AccountInfo<'info>,
    /// CHECK: Validated by Log Wrapper program
    pub log_wrapper: AccountInfo<'info>,
    /// CHECK: Validated by Bubblegum program
    pub bubblegum_program: AccountInfo<'info>,
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
    pub minimum_items: u64,
    pub is_graduated: bool,
    pub bump: u8,
}

impl AuctionState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // merkle_tree
        8 + // base_price
        8 + // price_increment
        8 + // current_supply
        8 + // max_supply
        8 + // total_value_locked
        8 + // minimum_items
        1 + // is_graduated
        1; // bump
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

#[event]
pub struct AuctionGraduated {
    pub auction: Pubkey,
    pub total_items: u64,
    pub total_value_locked: u64,
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
