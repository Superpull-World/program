use anchor_lang::prelude::*;
use anchor_spl::token;
use mpl_bubblegum::{
    instructions::{MintToCollectionV1Cpi, MintToCollectionV1CpiAccounts, MintToCollectionV1InstructionArgs},
    types::{Collection, MetadataArgs, TokenProgramVersion, TokenStandard},
};
use crate::{
    state::AuctionState,
    utils::{errors::BondingCurveError, events::{BidPlaced, AuctionGraduated}},
};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub auction: Account<'info, AuctionState>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// The bidder's token account to transfer from
    /// CHECK: Validated through token program CPI
    #[account(mut)]
    pub bidder_token_account: AccountInfo<'info>,

    /// The auction's token account to receive tokens
    /// CHECK: Validated through token program CPI
    #[account(mut)]
    pub auction_token_account: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    #[account(mut)]
    pub collection_mint: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    #[account(mut)]
    pub collection_metadata: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    #[account(mut)]
    pub collection_edition: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    pub collection_authority_record_pda: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    #[account(mut)]
    pub merkle_tree: AccountInfo<'info>,
    /// CHECK: Validated by Bubblegum program
    #[account(mut)]
    pub tree_config: AccountInfo<'info>,
    /// CHECK: Validated by Bubblegum program
    pub tree_creator: AccountInfo<'info>,

    /// CHECK: Validated by Bubblegum program
    #[account(
        seeds = [b"collection_cpi"],
        seeds::program = bubblegum_program.key(),
        bump,
    )]
    pub bubblegum_signer: UncheckedAccount<'info>,
    /// CHECK: Validated by Bubblegum program
    pub token_metadata_program: AccountInfo<'info>,
    /// CHECK: Validated by Compression program
    pub compression_program: AccountInfo<'info>,
    /// CHECK: Validated by Log Wrapper program
    pub log_wrapper: AccountInfo<'info>,
    /// CHECK: Validated by Bubblegum program
    pub bubblegum_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Validated by token program
    pub token_program: AccountInfo<'info>,
}

pub fn place_bid_handler(
    ctx: Context<PlaceBid>,
    amount: u64,
) -> Result<()> {
    // Validate bid amount
    require!(amount > 0, BondingCurveError::InvalidBidAmount);
    require!(
        !ctx.accounts.bidder.key().eq(&Pubkey::default()),
        BondingCurveError::InvalidBidder
    );

    let auction = &ctx.accounts.auction;
    
    // Check supply limit
    require!(
        auction.current_supply < auction.max_supply,
        BondingCurveError::MaxSupplyReached
    );

    // Calculate current price
    let current_price = auction.base_price
        .checked_add(
            auction.price_increment
                .checked_mul(auction.current_supply)
                .ok_or(BondingCurveError::MathOverflow)?
        )
        .ok_or(BondingCurveError::MathOverflow)?;

    // Validate bid amount against current price
    require!(
        amount >= current_price,
        BondingCurveError::InsufficientBidAmount
    );

    // Transfer tokens from bidder to auction account
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.bidder_token_account.to_account_info(),
        to: ctx.accounts.auction_token_account.to_account_info(),
        authority: ctx.accounts.bidder.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, amount)?;

    // Update auction state
    let auction = &mut ctx.accounts.auction;
    
    // Safe arithmetic operations
    auction.current_supply = auction.current_supply
        .checked_add(1)
        .ok_or(BondingCurveError::MathOverflow)?;
    
    auction.total_value_locked = auction.total_value_locked
        .checked_add(amount)
        .ok_or(BondingCurveError::MathOverflow)?;

    // Check for graduation
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
    let bubblegum_signer = ctx.accounts.bubblegum_signer.to_account_info();
    let collection_authority_record_pda = ctx.accounts.collection_authority_record_pda.to_account_info();

    // Initialize CPI
    let mint_to_collection_cpi = MintToCollectionV1Cpi::new(
        bubblegum_program.as_ref(),
        MintToCollectionV1CpiAccounts {
            tree_config: tree_config.as_ref(),
            leaf_owner: bidder.as_ref(),
            leaf_delegate: bidder.as_ref(),
            merkle_tree: merkle_tree.as_ref(),
            payer: payer.as_ref(),
            tree_creator_or_delegate: &auction_account.as_ref(),
            collection_authority: auction_account.as_ref(),
            collection_mint: collection_mint.as_ref(),
            collection_metadata: collection_metadata.as_ref(),
            collection_edition: collection_edition.as_ref(),
            collection_authority_record_pda: Some(collection_authority_record_pda.as_ref()),
            log_wrapper: log_wrapper.as_ref(),
            bubblegum_signer: bubblegum_signer.as_ref(),
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
                collection: Some(Collection {
                    key: collection_mint.key(),
                    verified: true,
                }),
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