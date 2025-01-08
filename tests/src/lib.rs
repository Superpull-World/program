use anchor_client::{
    solana_sdk::{
        commitment_config::CommitmentConfig,
        pubkey::Pubkey,
        signature::{read_keypair_file, Keypair},
        signer::Signer,
        system_program,
    },
    Client, Cluster,
};
use anchor_lang::prelude::Rent;
use mpl_bubblegum::{accounts::MerkleTree, instructions::CreateTreeConfigBuilder, ID as BUBBLEGUM_PROGRAM};
use std::str::FromStr;
use std::mem::size_of;

#[test]
fn test_initialize_auction() {
    let program_id = "EDX7DLx7YwQFFMC9peZh5nDqiB4bKVpa2SpvSfwz4XUG";
    let anchor_wallet = std::env::var("ANCHOR_WALLET").unwrap();
    let payer = read_keypair_file(&anchor_wallet).unwrap();

    let client = Client::new_with_options(Cluster::Localnet, &payer, CommitmentConfig::confirmed());
    let program_id = Pubkey::from_str(program_id).unwrap();
    let program = client.program(program_id).unwrap();
    let bubblegum_program = client.program(BUBBLEGUM_PROGRAM).unwrap();

    // Create test accounts
    let authority = &payer;
    let merkle_tree = Keypair::new();
    println!("Creating tree");
    let create_tree_ix = anchor_lang::solana_program::system_instruction::create_account(
        &authority.pubkey(),
        &merkle_tree.pubkey(),
        Rent::default().minimum_balance(size_of::<MerkleTree>()),
        size_of::<MerkleTree>() as u64,
        &authority.pubkey(),
    );
    let create_tree_tx = program
        .request()
        .instruction(create_tree_ix)
        .signer(authority)
        .signer(&merkle_tree)
        .send()
        .expect("Failed to create tree");
    println!("Create tree transaction signature: {}", create_tree_tx);

    println!("Creating tree config");
    let tree_config = Keypair::new();
    let create_tree_config_ix = CreateTreeConfigBuilder::new()
        .tree_config(tree_config.pubkey())
        .merkle_tree(merkle_tree.pubkey())
        .payer(authority.pubkey())
        .tree_creator(authority.pubkey())
        .max_depth(14)
        .max_buffer_size(64)
        .public(false)
        .instruction();

    let create_tree_config_tx = bubblegum_program
        .request()
        .instruction(create_tree_config_ix)
        .signer(authority)
        .send()
        .expect("Failed to create tree config");
    println!(
        "Create tree config transaction signature: {}",
        create_tree_config_tx
    );

    // Store pubkeys
    let merkle_tree_pubkey = merkle_tree.pubkey();
    let authority_pubkey = authority.pubkey();
    let tree_config_pubkey = tree_config.pubkey();

    // Set up auction parameters
    let base_price: u64 = 100_000;
    let price_increment: u64 = 10_000;
    let max_supply: u64 = 100;
    let minimum_items: u64 = 5;

    // Calculate auction PDA
    let seeds = &[
        b"auction",
        merkle_tree_pubkey.as_ref(),
        authority_pubkey.as_ref(),
    ];
    let (auction_pda, _bump) = Pubkey::find_program_address(seeds, &program_id);

    let tx = program
        .request()
        .accounts(superpull_program::accounts::InitializeAuction {
            auction: auction_pda,
            merkle_tree: merkle_tree_pubkey,
            authority: authority_pubkey,
            tree_config: tree_config_pubkey,
            tree_creator: authority.pubkey(),
            bubblegum_program: BUBBLEGUM_PROGRAM,
            system_program: system_program::ID,
        })
        .args(superpull_program::instruction::InitializeAuction {
            base_price,
            price_increment,
            max_supply,
            minimum_items,
        })
        .send()
        .expect("Failed to initialize auction");

    println!("Initialize auction transaction signature: {}", tx);

    // Verify auction state
    let auction_account = program
        .account::<superpull_program::AuctionState>(auction_pda)
        .expect("Failed to fetch auction account");

    assert_eq!(auction_account.authority, authority_pubkey);
    assert_eq!(auction_account.merkle_tree, merkle_tree_pubkey);
    assert_eq!(auction_account.base_price, base_price);
    assert_eq!(auction_account.price_increment, price_increment);
    assert_eq!(auction_account.current_supply, 0);
    assert_eq!(auction_account.max_supply, max_supply);
    assert_eq!(auction_account.total_value_locked, 0);
    assert_eq!(auction_account.minimum_items, minimum_items);
    assert_eq!(auction_account.is_graduated, false);
}

#[test]
fn test_place_bid_and_graduation() {
    let program_id = "EDX7DLx7YwQFFMC9peZh5nDqiB4bKVpa2SpvSfwz4XUG";
    let anchor_wallet = std::env::var("ANCHOR_WALLET").unwrap();
    let authority = read_keypair_file(&anchor_wallet).unwrap();
    let bidder = Keypair::new(); // Create a new bidder keypair

    let client = Client::new_with_options(Cluster::Localnet, &authority, CommitmentConfig::confirmed());
    let program_id = Pubkey::from_str(program_id).unwrap();
    let program = client.program(program_id).unwrap();
    let bubblegum_program = client.program(BUBBLEGUM_PROGRAM).unwrap();

    // Create test accounts
    let merkle_tree = Keypair::new();
    let create_tree_ix = anchor_lang::solana_program::system_instruction::create_account(
        &authority.pubkey(),
        &merkle_tree.pubkey(),
        Rent::default().minimum_balance(size_of::<MerkleTree>()),
        size_of::<MerkleTree>() as u64,
        &authority.pubkey(),
    );
    let create_tree_tx = program
        .request()
        .instruction(create_tree_ix)
        .signer(&authority)
        .signer(&merkle_tree)
        .send()
        .expect("Failed to create tree");
    println!("Create tree transaction signature: {}", create_tree_tx);

    let tree_config = Keypair::new();
    let create_tree_config_ix = CreateTreeConfigBuilder::new()
        .tree_config(tree_config.pubkey())
        .merkle_tree(merkle_tree.pubkey())
        .payer(authority.pubkey())
        .tree_creator(authority.pubkey())
        .max_depth(14)
        .max_buffer_size(64)
        .public(true)
        .instruction();

    let create_tree_config_tx = bubblegum_program
        .request()
        .instruction(create_tree_config_ix)
        .signer(&authority)
        .send()
        .expect("Failed to create tree config");
    println!("Create tree config transaction signature: {}", create_tree_config_tx);

    // Store pubkeys
    let merkle_tree_pubkey = merkle_tree.pubkey();
    let authority_pubkey = authority.pubkey();
    let bidder_pubkey = bidder.pubkey();
    let tree_config_pubkey = tree_config.pubkey();

    // Fund the bidder's account with some SOL for bids
    let transfer_ix = anchor_client::solana_sdk::system_instruction::transfer(
        &authority_pubkey,
        &bidder_pubkey,
        1_000_000_000, // 1 SOL
    );

    let fund_tx = program
        .request()
        .instruction(transfer_ix)
        .signer(&authority)
        .send()
        .expect("Failed to fund bidder account");

    println!("Funded bidder account: {}", fund_tx);

    // Set up auction parameters
    let base_price: u64 = 100_000;
    let price_increment: u64 = 10_000;
    let max_supply: u64 = 100;
    let minimum_items: u64 = 5;

    // Calculate auction PDA
    let seeds = &[
        b"auction",
        merkle_tree_pubkey.as_ref(),
        authority_pubkey.as_ref(),
    ];
    let (auction_pda, _bump) = Pubkey::find_program_address(seeds, &program_id);

    // Initialize auction first
    let tx = program
        .request()
        .accounts(superpull_program::accounts::InitializeAuction {
            auction: auction_pda,
            merkle_tree: merkle_tree_pubkey,
            authority: authority_pubkey,
            tree_config: tree_config_pubkey,
            tree_creator: authority_pubkey,
            bubblegum_program: BUBBLEGUM_PROGRAM,
            system_program: system_program::ID,
        })
        .args(superpull_program::instruction::InitializeAuction {
            base_price,
            price_increment,
            max_supply,
            minimum_items,
        })
        .signer(&authority)
        .send()
        .expect("Failed to initialize auction");

    println!("Initialize auction transaction signature: {}", tx);

    // Place bids until graduation (5 bids)
    for i in 0..minimum_items {
        let bid_amount = base_price + (price_increment * i);

        let tx = program
            .request()
            .accounts(superpull_program::accounts::PlaceBid {
                auction: auction_pda,
                bidder: bidder_pubkey,
                system_program: system_program::ID,
            })
            .args(superpull_program::instruction::PlaceBid {
                amount: bid_amount,
            })
            .signer(&bidder)  // Add bidder as signer
            .send()
            .expect(&format!("Failed to place bid {}", i + 1));

        println!("Bid {} transaction signature: {}", i + 1, tx);

        // Verify auction state after each bid
        let auction_account = program.account::<superpull_program::AuctionState>(auction_pda)
            .expect("Failed to fetch auction account");

        assert_eq!(auction_account.current_supply, i + 1);

        if i + 1 == minimum_items {
            // This should be the graduating bid
            assert_eq!(auction_account.is_graduated, true);
        } else {
            assert_eq!(auction_account.is_graduated, false);
        }
    }
}

#[test]
fn test_get_current_price() {
    let program_id = "EDX7DLx7YwQFFMC9peZh5nDqiB4bKVpa2SpvSfwz4XUG";
    let anchor_wallet = std::env::var("ANCHOR_WALLET").unwrap();
    let authority = read_keypair_file(&anchor_wallet).unwrap();

    let client = Client::new_with_options(Cluster::Localnet, &authority, CommitmentConfig::confirmed());
    let program_id = Pubkey::from_str(program_id).unwrap();
    let program = client.program(program_id).unwrap();
    let bubblegum_program = client.program(BUBBLEGUM_PROGRAM).unwrap();

    // Create test accounts
    let merkle_tree = Keypair::new();
    let create_tree_ix = anchor_lang::solana_program::system_instruction::create_account(
        &authority.pubkey(),
        &merkle_tree.pubkey(),
        Rent::default().minimum_balance(size_of::<MerkleTree>()),
        size_of::<MerkleTree>() as u64,
        &authority.pubkey(),
    );
    let create_tree_tx = program
        .request()
        .instruction(create_tree_ix)
        .signer(&authority)
        .signer(&merkle_tree)
        .send()
        .expect("Failed to create tree");
    println!("Create tree transaction signature: {}", create_tree_tx);

    let tree_config = Keypair::new();
    let create_tree_config_ix = CreateTreeConfigBuilder::new()
        .tree_config(tree_config.pubkey())
        .merkle_tree(merkle_tree.pubkey())
        .payer(authority.pubkey())
        .tree_creator(authority.pubkey())
        .max_depth(14)
        .max_buffer_size(64)
        .public(true)
        .instruction();

    let create_tree_config_tx = bubblegum_program
        .request()
        .instruction(create_tree_config_ix)
        .signer(&authority)
        .send()
        .expect("Failed to create tree config");
    println!("Create tree config transaction signature: {}", create_tree_config_tx);

    // Store pubkeys
    let merkle_tree_pubkey = merkle_tree.pubkey();
    let authority_pubkey = authority.pubkey();
    let tree_config_pubkey = tree_config.pubkey();

    // Set up auction parameters
    let base_price: u64 = 100_000;
    let price_increment: u64 = 10_000;
    let max_supply: u64 = 100;
    let minimum_items: u64 = 5;

    // Calculate auction PDA
    let seeds = &[
        b"auction",
        merkle_tree_pubkey.as_ref(),
        authority_pubkey.as_ref(),
    ];
    let (auction_pda, _bump) = Pubkey::find_program_address(seeds, &program_id);

    // Initialize auction first
    let tx = program
        .request()
        .accounts(superpull_program::accounts::InitializeAuction {
            auction: auction_pda,
            merkle_tree: merkle_tree_pubkey,
            authority: authority_pubkey,
            tree_config: tree_config_pubkey,
            tree_creator: authority_pubkey,
            bubblegum_program: BUBBLEGUM_PROGRAM,
            system_program: system_program::ID,
        })
        .args(superpull_program::instruction::InitializeAuction {
            base_price,
            price_increment,
            max_supply,
            minimum_items,
        })
        .send()
        .expect("Failed to initialize auction");

    println!("Initialize auction transaction signature: {}", tx);

    // Get current price
    let tx = program
        .request()
        .accounts(superpull_program::accounts::GetPrice {
            auction: auction_pda,
        })
        .args(superpull_program::instruction::GetCurrentPrice {})
        .send()
        .expect("Failed to get current price");

    println!("Get price transaction signature: {}", tx);

    // Verify price through account data
    let auction_account = program.account::<superpull_program::AuctionState>(auction_pda)
        .expect("Failed to fetch auction account");

    let expected_price = base_price + (price_increment * auction_account.current_supply);
    let current_price = auction_account.base_price +
        (auction_account.price_increment * auction_account.current_supply);

    assert_eq!(current_price, expected_price);
}
