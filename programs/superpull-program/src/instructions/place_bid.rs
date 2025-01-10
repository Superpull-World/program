use anchor_lang::prelude::*;
use mpl_bubblegum::{
    instructions::{MintToCollectionV1Cpi, MintToCollectionV1CpiAccounts, MintToCollectionV1InstructionArgs},
    types::{Collection, MetadataArgs, TokenProgramVersion, TokenStandard},
};
use crate::{
    state::AuctionState,
    utils::{errors::BondingCurveError, events::{BidPlaced, AuctionGraduated}},
};

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub auction: Account<'info, AuctionState>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

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
}

pub fn handler(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
    let current_price = {
        let auction = &ctx.accounts.auction;
        auction.base_price + (auction.price_increment * auction.current_supply)
    };

    let auction = &ctx.accounts.auction;
    require!(
        amount >= current_price,
        BondingCurveError::InsufficientBidAmount
    );
    require!(
        auction.current_supply < auction.max_supply,
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
    let new_supply = auction
        .current_supply
        .checked_add(1)
        .ok_or(BondingCurveError::MathOverflow)?;
    
    // Double check we haven't exceeded max supply
    require!(
        new_supply <= auction.max_supply,
        BondingCurveError::MaxSupplyReached
    );
    
    auction.current_supply = new_supply;
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