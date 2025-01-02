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

## Bonding Curve Implementation

The program implements a linear bonding curve with the formula:
```
current_price = base_price + (price_increment * current_supply)
```

Where:
- `base_price`: Initial price of the first NFT
- `price_increment`: Fixed amount by which price increases per NFT
- `current_supply`: Number of NFTs already minted

Benefits of this approach:
1. **Predictable Pricing**: Users can calculate future prices
2. **Fair Distribution**: Early supporters are rewarded with lower prices
3. **Price Discovery**: Market determines the true value over time
4. **Liquidity**: Continuous price curve ensures tradability

Example:
```
base_price = 1 SOL
price_increment = 0.1 SOL

1st NFT price = 1.0 SOL
2nd NFT price = 1.1 SOL
3rd NFT price = 1.2 SOL
...and so on
```

## Compressed NFTs

The program utilizes Solana's compressed NFTs, which offer several advantages:

1. **Cost Efficiency**:
   - Traditional NFT: ~0.012 SOL per mint
   - Compressed NFT: ~0.000001 SOL per mint
   - 99.99% cost reduction

2. **Storage Efficiency**:
   - Uses Merkle trees for data storage
   - Significantly reduced on-chain footprint
   - Enables large-scale NFT projects

3. **Scalability**:
   - Can mint millions of NFTs at minimal cost
   - Perfect for large collections or dynamic minting

## Technical Architecture

### Accounts
1. **Auction Account**:
   - Stores bonding curve parameters
   - Tracks current supply and total value
   - Manages merkle tree reference

2. **Merkle Tree**:
   - Stores compressed NFT data
   - Managed by Bubblegum program
   - Enables efficient proof verification

### Instructions
1. `initialize_auction`:
   - Creates new auction with specified parameters
   - Sets up bonding curve configuration

2. `place_bid`:
   - Mints compressed NFT to bidder
   - Updates price based on bonding curve
   - Manages auction state

3. `get_current_price`:
   - Calculates current NFT price
   - Returns price based on current supply

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
    new BN(1000)       // max_supply: 1000 NFTs
  )
  .accounts({...})
  .rpc();

// Place bid
await program.methods
  .placeBid(new BN(bid_amount))
  .accounts({...})
  .rpc();
```

## Security Considerations

1. **Price Manipulation Protection**:
   - Fixed price increment
   - Maximum supply limit
   - Automated price updates

2. **Access Control**:
   - PDA-based authority checks
   - Secure NFT minting process
   - Protected state updates

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request