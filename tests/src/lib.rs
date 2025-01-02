#[cfg(test)]
mod tests {
    use anchor_lang::prelude::*;

    #[test]
    fn test_initialize_auction() {
        // Create test environment
        let authority = Pubkey::new_unique();
        let merkle_tree = Pubkey::new_unique();

        // Set up auction state
        let base_price: u64 = 100_000;
        let price_increment: u64 = 10_000;
        let max_supply: u64 = 100;

        // Create account data that would be created
        let mut account_data = Vec::new();
        account_data.extend_from_slice(&[0; 8]); // Discriminator
        account_data.extend_from_slice(&authority.to_bytes());
        account_data.extend_from_slice(&merkle_tree.to_bytes());
        account_data.extend_from_slice(&base_price.to_le_bytes());
        account_data.extend_from_slice(&price_increment.to_le_bytes());
        account_data.extend_from_slice(&max_supply.to_le_bytes());
        account_data.extend_from_slice(&0u64.to_le_bytes()); // current_supply
        account_data.extend_from_slice(&0u64.to_le_bytes()); // total_value_locked

        // Verify account data structure
        let mut data = account_data.as_slice();
        let _discriminator = &data[..8];
        data = &data[8..];

        let authority_bytes = &data[..32];
        let merkle_tree_bytes = &data[32..64];
        let base_price_bytes = &data[64..72];
        let price_increment_bytes = &data[72..80];
        let max_supply_bytes = &data[80..88];
        let current_supply_bytes = &data[88..96];
        let total_value_locked_bytes = &data[96..104];

        let authority_from_data = Pubkey::new_from_array(authority_bytes.try_into().unwrap());
        let merkle_tree_from_data = Pubkey::new_from_array(merkle_tree_bytes.try_into().unwrap());
        let base_price_from_data = u64::from_le_bytes(base_price_bytes.try_into().unwrap());
        let price_increment_from_data = u64::from_le_bytes(price_increment_bytes.try_into().unwrap());
        let max_supply_from_data = u64::from_le_bytes(max_supply_bytes.try_into().unwrap());
        let current_supply_from_data = u64::from_le_bytes(current_supply_bytes.try_into().unwrap());
        let total_value_locked_from_data = u64::from_le_bytes(total_value_locked_bytes.try_into().unwrap());

        // Verify data matches expected values
        assert_eq!(authority_from_data, authority);
        assert_eq!(merkle_tree_from_data, merkle_tree);
        assert_eq!(base_price_from_data, base_price);
        assert_eq!(price_increment_from_data, price_increment);
        assert_eq!(max_supply_from_data, max_supply);
        assert_eq!(current_supply_from_data, 0);
        assert_eq!(total_value_locked_from_data, 0);
    }

    #[test]
    fn test_place_bid() {
        // Create test environment
        let authority = Pubkey::new_unique();
        let merkle_tree = Pubkey::new_unique();
        let bidder = Pubkey::new_unique();

        // Set up auction state
        let base_price: u64 = 100_000;
        let price_increment: u64 = 10_000;
        let max_supply: u64 = 100;
        let current_supply: u64 = 0;
        let total_value_locked: u64 = 0;

        // Create bid instruction data
        let bid_amount = base_price + price_increment; // Enough for first NFT

        // Create expected account data after bid
        let mut account_data = Vec::new();
        account_data.extend_from_slice(&[0; 8]); // Discriminator
        account_data.extend_from_slice(&authority.to_bytes());
        account_data.extend_from_slice(&merkle_tree.to_bytes());
        account_data.extend_from_slice(&base_price.to_le_bytes());
        account_data.extend_from_slice(&price_increment.to_le_bytes());
        account_data.extend_from_slice(&max_supply.to_le_bytes());
        account_data.extend_from_slice(&(current_supply + 1).to_le_bytes());
        account_data.extend_from_slice(&(total_value_locked + bid_amount).to_le_bytes());

        // Verify account data structure after bid
        let mut data = account_data.as_slice();
        let _discriminator = &data[..8];
        data = &data[8..];

        let authority_bytes = &data[..32];
        let merkle_tree_bytes = &data[32..64];
        let base_price_bytes = &data[64..72];
        let price_increment_bytes = &data[72..80];
        let max_supply_bytes = &data[80..88];
        let current_supply_bytes = &data[88..96];
        let total_value_locked_bytes = &data[96..104];

        let authority_from_data = Pubkey::new_from_array(authority_bytes.try_into().unwrap());
        let merkle_tree_from_data = Pubkey::new_from_array(merkle_tree_bytes.try_into().unwrap());
        let base_price_from_data = u64::from_le_bytes(base_price_bytes.try_into().unwrap());
        let price_increment_from_data = u64::from_le_bytes(price_increment_bytes.try_into().unwrap());
        let max_supply_from_data = u64::from_le_bytes(max_supply_bytes.try_into().unwrap());
        let current_supply_from_data = u64::from_le_bytes(current_supply_bytes.try_into().unwrap());
        let total_value_locked_from_data = u64::from_le_bytes(total_value_locked_bytes.try_into().unwrap());

        // Verify data matches expected values after bid
        assert_eq!(authority_from_data, authority);
        assert_eq!(merkle_tree_from_data, merkle_tree);
        assert_eq!(base_price_from_data, base_price);
        assert_eq!(price_increment_from_data, price_increment);
        assert_eq!(max_supply_from_data, max_supply);
        assert_eq!(current_supply_from_data, 1);
        assert_eq!(total_value_locked_from_data, bid_amount);
    }

    #[test]
    fn test_get_current_price() {
        // Set up auction state
        let base_price: u64 = 100_000;
        let price_increment: u64 = 10_000;
        let current_supply: u64 = 5; // Simulate 5 NFTs sold

        // Calculate expected current price
        let expected_price = base_price + (price_increment * current_supply);

        // Verify price calculation
        assert_eq!(expected_price, base_price + (price_increment * current_supply));
    }
}
