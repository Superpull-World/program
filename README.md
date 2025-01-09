# SuperPull Program

A Solana program implementing a bonding curve auction system for compressed NFTs, enabling efficient and cost-effective NFT distribution.

## Overview

SuperPull is a novel NFT distribution mechanism that combines:
1. Linear Bonding Curves for price discovery
2. Compressed NFTs for cost efficiency
3. Automated market making for liquidity

## Features

- **Linear Bonding Curve**: Transparent and predictable price increases
- **Compressed NFTs**: Significant cost reduction for minting and storage
- **Automated Price Discovery**: Price increases with each purchase
- **Fair Distribution**: Early supporters get better prices
- **Gas Efficiency**: Optimized for minimal transaction costs
- **Graduation Mechanism**: Ensures minimum participation before completion

## Program Instructions

### 1. Initialize Auction (`initialize_auction`)
Creates a new auction with specified parameters and sets up the bonding curve configuration.

**Parameters:**
- `base_price`: Initial price of the first NFT (in lamports)
- `price_increment`: Amount price increases per NFT (in lamports)
- `max_supply`: Maximum number of NFTs that can be minted
- `minimum_items`: Minimum number of items required for graduation

**Required Accounts:**
```
InitializeAuction {
    auction (PDA) [mut]           // Stores auction state
    merkle_tree                   // Compressed NFT storage
    collection_mint [mut]         // NFT collection mint
    authority (Signer) [mut]      // Auction manager
    bubblegum_program            // Bubblegum program for compression
    system_program               // System program
}
```

**Account Relationships:**
```
                                    ┌─────────────────┐
                                    │  System Program │
                                    └────────┬────────┘
                                             │
┌──────────┐         ┌─────────┐             │        ┌──────────────┐
│ Authority ├────────► Auction ◄───────────-─┴─────-──► Merkle Tree  │
└──────────┘         │   PDA   │                      └──────┬───────┘
                     └────┬────┘                             │
                          │                                  │
                     ┌────▼────-┐                     ┌──────▼───────┐
                     │Collection│                     │   Bubblegum  │
                     │  Mint    │                     │   Program    │
                     └─────────-┘                     └──────────────┘
```

### 2. Get Current Price (`get_current_price`)
Calculates and returns the current NFT price based on supply.

**Required Accounts:**
```
GetPrice {
    auction                      // Auction state account
}
```

**Events Emitted:**
```
PriceUpdate {
    auction: Pubkey,            // Auction address
    price: u64,                 // Current calculated price
    supply: u64                 // Current supply
}
```

### 3. Place Bid (`place_bid`)
Places a bid and mints a compressed NFT to the bidder.

**Parameters:**
- `amount`: Bid amount in lamports (must be >= current price)

**Required Accounts:**
```
PlaceBid {
    auction [mut]                      // Auction state
    bidder (Signer) [mut]             // NFT recipient
    payer (Signer) [mut]              // Pays for the NFT
    collection_mint [mut]              // Collection mint account
    collection_metadata [mut]          // Collection metadata
    collection_edition [mut]           // Collection master edition
    collection_authority_record_pda    // Collection authority record
    merkle_tree [mut]                 // Compressed NFT storage
    tree_config [mut]                 // Merkle tree configuration
    tree_creator                      // Tree creator/authority
    bubblegum_signer                  // Bubblegum program signer
    token_metadata_program            // Token metadata program
    compression_program               // Compression program
    log_wrapper                       // Log wrapper program
    bubblegum_program                 // Bubblegum program
    system_program                    // System program
}
```

**Account Relationships:**
```
┌────────┐    ┌─────────┐    ┌──────────────┐
│ Bidder ├────► Auction ◄────┤ Merkle Tree  │
└───┬────┘    │   PDA   │    └──────┬───────┘
    │         └────┬────┘           │
    │              │                │
┌───▼────┐   ┌────▼────┐    ┌──────▼───────┐
│ Payer  │   │Collection│   │   Bubblegum  │
└────────┘   │  Mint   │    │   Program    │
             └────┬────┘    └──────┬───────┘
                  │               │
         ┌────────▼───────┐   ┌──▼────────-──┐
         │   Metadata     │   │ Compression  │
         │   Program      │   │   Program    │
         └─────────────--─┘   └───────────-──┘
```

## State Accounts

### AuctionState
Stores the auction configuration and current state:
```rust
pub struct AuctionState {
    pub authority: Pubkey,         // Auction manager
    pub merkle_tree: Pubkey,       // Associated merkle tree
    pub base_price: u64,           // Initial NFT price
    pub price_increment: u64,      // Price increase per mint
    pub current_supply: u64,       // Number of NFTs minted
    pub max_supply: u64,           // Maximum supply cap
    pub total_value_locked: u64,   // Total SOL collected
    pub minimum_items: u64,        // Required items for graduation
    pub is_graduated: bool,        // Graduation status
    pub bump: u8,                  // PDA bump
}
```

## Events

### 1. PriceUpdate
Emitted when price is queried:
```rust
pub struct PriceUpdate {
    pub auction: Pubkey,
    pub price: u64,
    pub supply: u64,
}
```

### 2. BidPlaced
Emitted when a bid is successful:
```rust
pub struct BidPlaced {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub new_supply: u64,
}
```

### 3. AuctionGraduated
Emitted when minimum items threshold is reached:
```rust
pub struct AuctionGraduated {
    pub auction: Pubkey,
    pub total_items: u64,
    pub total_value_locked: u64,
}
```

## Error Handling

The program includes the following custom errors:
```rust
pub enum BondingCurveError {
    InsufficientBidAmount,    // Bid below current price
    MaxSupplyReached,         // Supply cap reached
    MathOverflow,            // Arithmetic overflow
}
```

## Security Considerations

1. **Price Manipulation Protection**:
   - Fixed price increment ensures predictable pricing
   - Maximum supply limit prevents infinite minting
   - Automated price updates prevent manual manipulation

2. **Access Control**:
   - PDA-based authority checks for auction management
   - Secure NFT minting through Bubblegum program
   - Protected state updates with proper account validation

3. **Graduation Mechanism**:
   - Ensures minimum participation before completion
   - Prevents early abandonment of auctions
   - Protects participant interests

## Usage

### Prerequisites
- Solana Tool Suite
- Anchor Framework
- Node.js and npm

### Installation
```bash
git clone <repository-url>
cd superpull-program
anchor build
```

### Testing
```bash
anchor test
```

### Deployment
```bash
anchor deploy
```

## Example Interaction

```typescript
// Initialize auction
await program.methods
  .initializeAuction(
    new BN(1_000_000), // base_price: 1 SOL
    new BN(100_000),   // price_increment: 0.1 SOL
    new BN(1000),      // max_supply: 1000 NFTs
    new BN(5)          // minimum_items: 5 NFTs
  )
  .accounts({...})
  .rpc();

// Place bid
await program.methods
  .placeBid(new BN(bid_amount))
  .accounts({...})
  .rpc();

// Get current price
await program.methods
  .getCurrentPrice()
  .accounts({
    auction: auctionPda,
  })
  .rpc();
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request