# SuperPull Program

A Solana program implementing a graduated bonding curve auction mechanism for NFT collections with compressed NFTs.

## Overview

The SuperPull Program enables creators to launch NFT collections using a graduated bonding curve pricing mechanism. The price increases with each mint, and the collection "graduates" once it reaches a minimum number of mints.

## Features

- **Graduated Bonding Curve**: Price increases linearly with each mint
- **Compressed NFTs**: Uses Metaplex Bubblegum for gas-efficient NFT minting
- **Automatic Graduation**: Collection graduates after reaching minimum items
- **Secure Withdrawals**: Authority can withdraw funds after graduation
- **Collection Authority**: Auction PDA acts as collection authority

## Key Instructions

### Initialize Auction
- Creates a new auction for a collection
- Parameters:
  - `base_price`: Starting price for NFTs
  - `price_increment`: Price increase per mint
  - `max_supply`: Maximum number of NFTs
  - `minimum_items`: Required mints for graduation

### Place Bid
- Mints a new NFT at current price
- Price = base_price + (price_increment * current_supply)
- Automatically graduates auction when minimum_items reached

### Get Price
- Returns current mint price
- Emits price update event

### Withdraw
- Allows authority to withdraw funds after graduation
- Only available when:
  - Auction has graduated (minimum_items reached)
  - Called by auction authority
- Maintains rent-exempt balance for program accounts

## Account Structure

### AuctionState
```rust
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
```

## Events

### PriceUpdate
```rust
pub struct PriceUpdate {
    pub auction: Pubkey,
    pub price: u64,
    pub supply: u64,
}
```

### BidPlaced
```rust
pub struct BidPlaced {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub new_supply: u64,
}
```

### AuctionGraduated
```rust
pub struct AuctionGraduated {
    pub auction: Pubkey,
    pub total_items: u64,
    pub total_value_locked: u64,
}
```

### FundsWithdrawn
```rust
pub struct FundsWithdrawn {
    pub auction: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
}
```


## Building and Testing

```bash
# Build the program
anchor build

# Run tests
anchor test
```

## Security Considerations

- Auction authority is the only account that can withdraw funds
- Withdrawals only allowed after graduation
- Rent-exempt balance is always maintained
- All arithmetic operations use checked math to prevent overflows
- Proper PDA validation for auction accounts

## Dependencies

- Anchor Framework
- Metaplex Bubblegum (compressed NFTs)
- Metaplex Token Metadata Program