use anchor_lang::prelude::*;

#[error_code]
pub enum SuperpullProgramError {
    // General errors
    #[msg("Math operation overflowed")]
    MathOverflow,
    
    // Initialization errors
    #[msg("Base price must be greater than zero")]
    InvalidBasePrice,
    #[msg("Price increment must be greater than zero")]
    InvalidPriceIncrement,
    #[msg("Maximum supply must be greater than zero")]
    InvalidMaxSupply,
    #[msg("Minimum items must be greater than zero and less than max supply")]
    InvalidMinimumItems,
    #[msg("Invalid merkle tree configuration")]
    InvalidMerkleTree,

    // Bid errors
    #[msg("Bid amount is less than current price")]
    InsufficientBidAmount,
    #[msg("Maximum supply reached")]
    MaxSupplyReached,
    #[msg("Invalid bid amount provided")]
    InvalidBidAmount,
    #[msg("Bidder cannot be the zero address")]
    InvalidBidder,
    #[msg("Token account mint does not match auction token mint")]
    InvalidTokenMint,

    // Withdrawal errors
    #[msg("Unauthorized withdrawal attempt")]
    UnauthorizedWithdraw,
    #[msg("Auction must be graduated to withdraw funds")]
    NotGraduated,
    #[msg("No funds available to withdraw")]
    NoFundsToWithdraw,
    #[msg("Cannot withdraw below rent-exempt balance")]
    InsufficientRentBalance,
    #[msg("Withdrawal amount exceeds available balance")]
    ExcessiveWithdrawalAmount,

    // State errors
    #[msg("Auction has already graduated")]
    AlreadyGraduated,
    #[msg("Auction has not reached minimum items")]
    MinimumItemsNotReached,
    #[msg("Invalid auction state")]
    InvalidAuctionState,

    // Account validation errors
    #[msg("Invalid authority provided")]
    InvalidAuthority,
    #[msg("Invalid account owner")]
    InvalidAccountOwner,
    #[msg("Account is not rent exempt")]
    NotRentExempt,

    // Auction expiration errors
    #[msg("Invalid deadline")]
    InvalidDeadline,
    #[msg("Auction expired")]
    AuctionExpired,

    // Refund errors
    #[msg("Cannot refund when auction is graduated or deadline not reached")]
    InvalidRefundAttempt,
    #[msg("No bid amount to refund")]
    NoFundsToRefund,
    #[msg("Failed to burn NFT during refund")]
    NftBurnError,
} 