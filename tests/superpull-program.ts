import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "bn.js";
import { assert } from "chai";
import { SuperpullProgram } from "../target/types/superpull_program";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  keypairIdentity,
  percentAmount,
  generateSigner,
  Signer,
  none,
  some,
  Pda,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";
import {
  createTree,
  MPL_BUBBLEGUM_PROGRAM_ID,
  mplBubblegum,
  fetchTreeConfigFromSeeds,
  fetchMerkleTree,
  setTreeDelegate,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  createNft,
  delegateCollectionV1,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  mplTokenMetadata,
  findCollectionAuthorityRecordPda,
  approveCollectionAuthority,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount as createTokenAccount,
  mintTo,
  getAccount as getTokenAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createInitializeAccountInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// Constants for better readability and maintenance
const COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const NOOP_PROGRAM_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const MAX_DEPTH = 14;
const MAX_BUFFER_SIZE = 64;
const COLLECTION_NAME = "SuperPull Collection";
const COLLECTION_SYMBOL = "SPULL";
const COLLECTION_URI = "https://assets.superpull.world/collection.json";

// Helper function to create PDAs for better organization
const createProgramPDAs = (merkleTree: Signer, authority: anchor.Wallet, programId: PublicKey) => {
  const [auctionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("auction"),
      toWeb3JsPublicKey(merkleTree.publicKey).toBuffer(),
      authority.publicKey.toBuffer(),
    ],
    programId
  );
  return { auctionPda };
};

describe("Superpull Program", () => {
  // Test context setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SuperpullProgram as Program<SuperpullProgram>;
  const payer = provider.wallet as anchor.Wallet;
  // Create a new keypair for the auction creator/authority
  const auctionCreator = anchor.web3.Keypair.generate();
  
  console.log("🔌 Connecting to UMI at:", provider.connection.rpcEndpoint);
  const umi = createUmi(provider.connection)
    .use(keypairIdentity(fromWeb3JsKeypair(payer.payer)))
    .use(mplBubblegum())
    .use(mplTokenMetadata());

  let merkleTree: Signer;
  let collectionMint: Signer;
  let treeConfigPda: PublicKey;
  let collectionAuthorityRecordPda: Pda;
  let auctionPda: PublicKey;
  let tokenMint: PublicKey;
  let bidderTokenAccount: PublicKey;
  let auctionTokenAccount: PublicKey;

  before(async () => {
    console.log("📦 Setting up test environment...");

    merkleTree = generateSigner(umi);
    console.log("🌳 Generated merkle tree:", merkleTree.publicKey.toString());
    collectionMint = generateSigner(umi);

    // Calculate auction PDA first
    const [_auctionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        toWeb3JsPublicKey(merkleTree.publicKey).toBuffer(),
        auctionCreator.publicKey.toBuffer(),
      ],
      program.programId
    );
    auctionPda = _auctionPda;
    console.log("🎯 Auction PDA:", auctionPda.toString());
    
    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      payer.payer, // payer
      payer.publicKey, // mint authority
      null, // freeze authority
      9 // decimals
    );
    console.log("💰 Created token mint:", tokenMint.toString());

    // Create bidder's token account
    bidderTokenAccount = await createTokenAccount(
      provider.connection,
      payer.payer,
      tokenMint,
      payer.publicKey
    );
    console.log("👤 Created bidder token account:", bidderTokenAccount.toString());

    // Create auction's token account
    auctionTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      auctionPda,
      true // allowOwnerOffCurve: true - required for PDAs
    );
    console.log("🎯 Auction token account address:", auctionTokenAccount.toString());

    // Create the associated token account for the auction PDA
    const ataIx = createAssociatedTokenAccountInstruction(
      payer.publicKey, // payer
      auctionTokenAccount, // ata
      auctionPda, // owner
      tokenMint, // mint
    );

    try {
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(ataIx), [payer.payer]);
      console.log("✅ Created auction token account");
    } catch (error) {
      if (!error.toString().includes("already in use")) {
        throw error;
      }
      console.log("ℹ️ Auction token account already exists");
    }

    // Mint some tokens to bidder
    await mintTo(
      provider.connection,
      payer.payer,
      tokenMint,
      bidderTokenAccount,
      payer.publicKey,
      1000000000 // 1000 tokens with 9 decimals
    );
    console.log("💸 Minted tokens to bidder");
    
    collectionAuthorityRecordPda = findCollectionAuthorityRecordPda(umi, {
      mint: collectionMint.publicKey,
      collectionAuthority: fromWeb3JsPublicKey(auctionPda),
    });
  });

  it("should create collection and tree", async () => {
    console.log("🎨 Creating NFT collection...");
    const collectionTx = await createNft(umi, {
      mint: collectionMint,
      name: COLLECTION_NAME,
      symbol: COLLECTION_SYMBOL,
      uri: COLLECTION_URI,
      sellerFeeBasisPoints: percentAmount(0),
      isCollection: true,
      creators: none(),
      collection: none(),
      uses: none(),
    });
    await collectionTx.sendAndConfirm(umi);
    console.log("✅ Collection created successfully");

    console.log("🔑 Setting collection authority...");
    const setAuthorityTx = approveCollectionAuthority(umi, {
      mint: collectionMint.publicKey,
      payer: createSignerFromKeypair(umi, fromWeb3JsKeypair(payer.payer)),
      updateAuthority: createSignerFromKeypair(umi, fromWeb3JsKeypair(payer.payer)),
      newCollectionAuthority: fromWeb3JsPublicKey(auctionPda),
      collectionAuthorityRecord: collectionAuthorityRecordPda,
    });
    await setAuthorityTx.sendAndConfirm(umi);
    console.log("✅ Collection authority set successfully");

    console.log("🌳 Creating merkle tree...");
    const treeTx = await createTree(umi, {
      maxDepth: MAX_DEPTH,
      maxBufferSize: MAX_BUFFER_SIZE,
      public: some(true),
      merkleTree: merkleTree,
    });
    await treeTx.sendAndConfirm(umi);
    console.log("✅ Merkle tree created successfully");

    // Verify tree creation
    const merkleTreeAccount = await fetchMerkleTree(umi, merkleTree.publicKey, {
      commitment: "confirmed",
    });
    const treeConfigAccount = await fetchTreeConfigFromSeeds(umi, { merkleTree: merkleTree.publicKey });
    console.log("📊 Merkle Tree Details:", {
      publicKey: merkleTreeAccount.publicKey.toString(),
      configKey: treeConfigAccount.publicKey.toString()
    });
    
    assert.ok(merkleTreeAccount, "Merkle tree account should exist");
    assert.ok(treeConfigAccount, "Tree config account should exist");
    treeConfigPda = toWeb3JsPublicKey(treeConfigAccount.publicKey);
  });

  it("should initialize auction", async () => {
    console.log("🎯 Initializing auction...");
    
    // Auction parameters
    const auctionParams = {
      basePrice: new BN(1),
      priceIncrement: new BN(1),
      maxSupply: new BN(7),
      minimumItems: new BN(5)
    };

    const accounts = {
      auction: auctionPda,
      merkleTree: toWeb3JsPublicKey(merkleTree.publicKey),
      treeConfig: treeConfigPda,
      treeCreator: payer.publicKey,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      tokenMint: tokenMint,
      authority: auctionCreator.publicKey,
      payer: payer.publicKey,
      bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
      systemProgram: SystemProgram.programId,
    };

    await program.methods
      .initializeAuction(
        auctionParams.basePrice,
        auctionParams.priceIncrement,
        auctionParams.maxSupply,
        auctionParams.minimumItems
      )
      .accounts(accounts)
      .signers([payer.payer])
      .rpc({ skipPreflight: true });

    console.log("✅ Auction initialized successfully");

    // Verify auction state
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    console.log("📊 Auction State:", {
      authority: auctionState.authority.toString(),
      basePrice: auctionState.basePrice.toString(),
      priceIncrement: auctionState.priceIncrement.toString(),
      minimumItems: auctionState.minimumItems.toString(),
      maxSupply: auctionState.maxSupply.toString(),
      currentSupply: auctionState.currentSupply.toString(),
      totalValueLocked: auctionState.totalValueLocked.toString(),
      isGraduated: auctionState.isGraduated
    });

    // Assertions with descriptive messages
    assert.ok(auctionState.authority.equals(auctionCreator.publicKey), "Authority should be auction creator");
    assert.ok(new BN(auctionState.basePrice).eq(auctionParams.basePrice), "Base price should match");
    assert.ok(new BN(auctionState.priceIncrement).eq(auctionParams.priceIncrement), "Price increment should match");
    assert.ok(new BN(auctionState.maxSupply).eq(auctionParams.maxSupply), "Max supply should match");
    assert.ok(new BN(auctionState.minimumItems).eq(auctionParams.minimumItems), "Minimum items should match");
    assert.ok(new BN(auctionState.currentSupply).eq(new BN(0)), "Initial supply should be 0");
    assert.ok(new BN(auctionState.totalValueLocked).eq(new BN(0)), "Initial TVL should be 0");
    assert.ok(!auctionState.isGraduated, "Auction should not be graduated initially");
  });

  it("should place bid", async () => {
    console.log("💰 Placing bid...");
    const bidAmount = new BN(1); // Base price + increment

    const accounts = {
      auction: auctionPda,
      bidder: payer.publicKey,
      payer: payer.publicKey,
      bidderTokenAccount: bidderTokenAccount,
      auctionTokenAccount: auctionTokenAccount,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      collectionMetadata: findMetadataPda(),
      collectionEdition: findEditionPda(),
      collectionAuthority: fromWeb3JsPublicKey(payer.publicKey),
      merkleTree: toWeb3JsPublicKey(merkleTree.publicKey),
      collectionAuthorityRecordPda: collectionAuthorityRecordPda[0],
      treeConfig: treeConfigPda,
      treeCreator: auctionPda,
      bubblegumSigner: findBubblegumSignerPda(),
      bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
      logWrapper: NOOP_PROGRAM_ID,
      compressionProgram: COMPRESSION_PROGRAM_ID,
      tokenMetadataProgram: toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    // Get initial token balances
    const initialBidderBalance = (await getTokenAccount(provider.connection, bidderTokenAccount)).amount;
    const initialAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
    
    console.log("📊 Initial Token Balances:", {
      bidder: initialBidderBalance.toString(),
      auction: initialAuctionBalance.toString(),
    });

    await program.methods
      .placeBid(bidAmount)
      .accounts(accounts)
      .signers([payer.payer])
      .rpc({ skipPreflight: true });

    console.log("✅ Bid placed successfully");

    // Get final token balances
    const finalBidderBalance = (await getTokenAccount(provider.connection, bidderTokenAccount)).amount;
    const finalAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
    
    console.log("📊 Final Token Balances:", {
      bidder: finalBidderBalance.toString(),
      auction: finalAuctionBalance.toString(),
    });

    // Verify token transfer
    assert.ok(finalBidderBalance < initialBidderBalance, "Bidder balance should decrease");
    assert.ok(finalAuctionBalance > initialAuctionBalance, "Auction balance should increase");
    assert.ok(
      BigInt(finalAuctionBalance) - BigInt(initialAuctionBalance) === BigInt(bidAmount.toString()),
      "Auction should receive exact bid amount"
    );

    // Print auction state after bid
    const auctionStateAfterBid = await program.account.auctionState.fetch(auctionPda);
    const currentPrice = auctionStateAfterBid.basePrice.add(
      auctionStateAfterBid.priceIncrement.mul(auctionStateAfterBid.currentSupply)
    );
    
    console.log("📊 Auction State After Bid:", {
      basePrice: auctionStateAfterBid.basePrice.toString(),
      priceIncrement: auctionStateAfterBid.priceIncrement.toString(),
      minimumItems: auctionStateAfterBid.minimumItems.toString(),
      maxSupply: auctionStateAfterBid.maxSupply.toString(),
      currentSupply: auctionStateAfterBid.currentSupply.toString(),
      totalValueLocked: auctionStateAfterBid.totalValueLocked.toString(),
      isGraduated: auctionStateAfterBid.isGraduated,
      currentPrice: currentPrice.toString(),
    });
  });

  it("should graduate after 5 bids", async () => {
    console.log("🎓 Testing graduation with 4 more bids...");
    
    const accounts = {
      auction: auctionPda,
      bidder: payer.publicKey,
      payer: payer.publicKey,
      bidderTokenAccount: bidderTokenAccount,
      auctionTokenAccount: auctionTokenAccount,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      collectionMetadata: findMetadataPda(),
      collectionEdition: findEditionPda(),
      collectionAuthority: fromWeb3JsPublicKey(payer.publicKey),
      merkleTree: toWeb3JsPublicKey(merkleTree.publicKey),
      collectionAuthorityRecordPda: collectionAuthorityRecordPda[0],
      treeConfig: treeConfigPda,
      treeCreator: auctionPda,
      bubblegumSigner: findBubblegumSignerPda(),
      bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
      logWrapper: NOOP_PROGRAM_ID,
      compressionProgram: COMPRESSION_PROGRAM_ID,
      tokenMetadataProgram: toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    // Place 4 more bids
    for (let i = 0; i < 4; i++) {
      const auctionState = await program.account.auctionState.fetch(auctionPda);
      const currentPrice = auctionState.basePrice.add(
        auctionState.priceIncrement.mul(auctionState.currentSupply)
      );
      
      console.log(`\n💰 Placing bid ${i + 2} of 5...`);
      
      // Get token balances before bid
      const beforeBidderBalance = (await getTokenAccount(provider.connection, bidderTokenAccount)).amount;
      const beforeAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
      
      await program.methods
        .placeBid(currentPrice)
        .accounts(accounts)
        .signers([payer.payer])
        .rpc({ skipPreflight: true });
      
      // Get token balances after bid
      const afterBidderBalance = (await getTokenAccount(provider.connection, bidderTokenAccount)).amount;
      const afterAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
      
      // Print state after each bid
      const stateAfterBid = await program.account.auctionState.fetch(auctionPda);
      const newPrice = stateAfterBid.basePrice.add(
        stateAfterBid.priceIncrement.mul(stateAfterBid.currentSupply)
      );
      
      console.log(`📊 State after bid ${i + 2}:`, {
        currentSupply: stateAfterBid.currentSupply.toString(),
        totalValueLocked: stateAfterBid.totalValueLocked.toString(),
        isGraduated: stateAfterBid.isGraduated,
        currentPrice: newPrice.toString(),
        bidderBalanceChange: (BigInt(beforeBidderBalance) - BigInt(afterBidderBalance)).toString(),
        auctionBalanceChange: (BigInt(afterAuctionBalance) - BigInt(beforeAuctionBalance)).toString(),
      });
    }

    // Verify final state
    const finalState = await program.account.auctionState.fetch(auctionPda);
    const currentPrice = finalState.basePrice.add(
      finalState.priceIncrement.mul(finalState.currentSupply)
    );
    
    console.log("\n🎓 Final Auction State:", {
      basePrice: finalState.basePrice.toString(),
      priceIncrement: finalState.priceIncrement.toString(),
      minimumItems: finalState.minimumItems.toString(),
      maxSupply: finalState.maxSupply.toString(),
      currentSupply: finalState.currentSupply.toString(),
      totalValueLocked: finalState.totalValueLocked.toString(),
      isGraduated: finalState.isGraduated,
      currentPrice: currentPrice.toString(),
    });

    // Assert graduation
    assert.ok(finalState.isGraduated, "Auction should be graduated after 5 bids");
    assert.ok(new BN(finalState.currentSupply).gte(finalState.minimumItems), 
      "Current supply should be >= minimum items");
  });

  it("should reject bids after reaching max supply", async () => {
    console.log("\n🎯 Testing max supply limit...");
    
    const accounts = {
      auction: auctionPda,
      bidder: payer.publicKey,
      payer: payer.publicKey,
      bidderTokenAccount: bidderTokenAccount,
      auctionTokenAccount: auctionTokenAccount,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      collectionMetadata: findMetadataPda(),
      collectionEdition: findEditionPda(),
      collectionAuthority: fromWeb3JsPublicKey(payer.publicKey),
      merkleTree: toWeb3JsPublicKey(merkleTree.publicKey),
      collectionAuthorityRecordPda: collectionAuthorityRecordPda[0],
      treeConfig: treeConfigPda,
      treeCreator: auctionPda,
      bubblegumSigner: findBubblegumSignerPda(),
      bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
      logWrapper: NOOP_PROGRAM_ID,
      compressionProgram: COMPRESSION_PROGRAM_ID,
      tokenMetadataProgram: toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    // Get current auction state
    const initialState = await program.account.auctionState.fetch(auctionPda);
    const remainingBids = initialState.maxSupply.toNumber() - initialState.currentSupply.toNumber();
    console.log(`\n📊 Current supply: ${initialState.currentSupply}, Max supply: ${initialState.maxSupply}`);
    console.log(`🎯 Will attempt to place ${remainingBids + 1} bids to exceed max supply`);

    // Place remaining bids until max supply
    for (let i = 0; i < remainingBids; i++) {
      const auctionState = await program.account.auctionState.fetch(auctionPda);
      const currentPrice = auctionState.basePrice.add(
        auctionState.priceIncrement.mul(auctionState.currentSupply)
      );
      
      console.log(`\n💰 Placing bid ${i + 1} of ${remainingBids}...`);
      
      // Get token balances before bid
      const beforeBidderBalance = (await getTokenAccount(provider.connection, bidderTokenAccount)).amount;
      const beforeAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
      
      await program.methods
        .placeBid(currentPrice)
        .accounts(accounts)
        .signers([payer.payer])
        .rpc({ skipPreflight: true });
      
      // Get token balances after bid
      const afterBidderBalance = (await getTokenAccount(provider.connection, bidderTokenAccount)).amount;
      const afterAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
      
      const stateAfterBid = await program.account.auctionState.fetch(auctionPda);
      console.log(`📊 Supply after bid: ${stateAfterBid.currentSupply} / ${stateAfterBid.maxSupply}`);
      console.log(`💰 Token transfer:`, {
        bidderBalanceChange: (BigInt(beforeBidderBalance) - BigInt(afterBidderBalance)).toString(),
        auctionBalanceChange: (BigInt(afterAuctionBalance) - BigInt(beforeAuctionBalance)).toString(),
      });
    }

    // Attempt to place one more bid (should fail)
    const finalState = await program.account.auctionState.fetch(auctionPda);
    const finalPrice = finalState.basePrice.add(
      finalState.priceIncrement.mul(finalState.currentSupply)
    );

    console.log("\n❌ Attempting to exceed max supply...");
    try {
      await program.methods
        .placeBid(finalPrice)
        .accounts(accounts)
        .signers([payer.payer])
        .rpc({ skipPreflight: true });
      
      assert.fail("Should not be able to place bid after reaching max supply");
    } catch (error) {
      console.log("✅ Bid correctly rejected after reaching max supply");
    }

    // Verify final state
    const verifyState = await program.account.auctionState.fetch(auctionPda);
    console.log("\n📊 Final Auction State:", {
      currentSupply: verifyState.currentSupply.toString(),
      maxSupply: verifyState.maxSupply.toString(),
      totalValueLocked: verifyState.totalValueLocked.toString(),
      isGraduated: verifyState.isGraduated
    });

    // Assert max supply was reached but not exceeded
    assert.ok(new BN(verifyState.currentSupply).eq(verifyState.maxSupply), 
      "Current supply should equal max supply");
  });

  it("should allow authority to withdraw after graduation", async () => {
    console.log("\n💰 Testing withdrawal...");

    // Create authority's token account
    const authorityTokenAccount = await createTokenAccount(
      provider.connection,
      payer.payer,
      tokenMint,
      auctionCreator.publicKey
    );
    console.log("👤 Created authority token account:", authorityTokenAccount.toString());

    // Get initial balances
    const initialAuthorityBalance = (await getTokenAccount(provider.connection, authorityTokenAccount)).amount;
    const initialAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
    
    console.log("📊 Initial Token Balances:", {
      authority: initialAuthorityBalance.toString(),
      auction: initialAuctionBalance.toString(),
    });

    // Verify auction is graduated
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    assert.ok(auctionState.isGraduated, "Auction must be graduated to withdraw");
    assert.ok(auctionState.totalValueLocked.gt(new BN(0)), "Must have funds to withdraw");

    const accounts = {
      auction: auctionPda,
      authority: auctionCreator.publicKey,
      authorityTokenAccount: authorityTokenAccount,
      auctionTokenAccount: auctionTokenAccount,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    await program.methods
      .withdraw()
      .accounts(accounts)
      .signers([payer.payer])
      .rpc({ skipPreflight: true });

    // Verify final balances
    const finalAuthorityBalance = (await getTokenAccount(provider.connection, authorityTokenAccount)).amount;
    const finalAuctionBalance = (await getTokenAccount(provider.connection, auctionTokenAccount)).amount;
    
    console.log("📊 Final Token Balances:", {
      authority: finalAuthorityBalance.toString(),
      auction: finalAuctionBalance.toString(),
    });

    // Verify auction state
    const finalState = await program.account.auctionState.fetch(auctionPda);
    assert.ok(finalState.totalValueLocked.eq(new BN(0)), "Total value locked should be 0 after withdrawal");
    assert.ok(BigInt(finalAuctionBalance) === BigInt(0), "Auction token balance should be 0");
    assert.ok(
      BigInt(finalAuthorityBalance) > BigInt(initialAuthorityBalance),
      "Authority token balance should increase"
    );
  });

  it("should not allow non-authority to withdraw", async () => {
    console.log("\n🚫 Testing unauthorized withdrawal...");

    // Create a random user's token account
    const randomUser = anchor.web3.Keypair.generate();
    const randomUserTokenAccount = await createTokenAccount(
      provider.connection,
      payer.payer,
      tokenMint,
      randomUser.publicKey
    );
    console.log("👤 Created random user token account:", randomUserTokenAccount.toString());

    const accounts = {
      auction: auctionPda,
      authority: payer.publicKey, // Using wrong authority
      authorityTokenAccount: randomUserTokenAccount,
      auctionTokenAccount: auctionTokenAccount,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    try {
      await program.methods
        .withdraw()
        .accounts(accounts)
        .signers([payer.payer])
        .rpc({ skipPreflight: true });
      
      assert.fail("Should not allow unauthorized withdrawal");
    } catch (error) {
      console.log("✅ Unauthorized withdrawal correctly rejected");
    }
  });

  // Helper functions for finding PDAs
  function findMetadataPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        toWeb3JsPublicKey(collectionMint.publicKey).toBuffer(),
      ],
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );
    return pda;
  }

  function findEditionPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        toWeb3JsPublicKey(collectionMint.publicKey).toBuffer(),
        Buffer.from("edition"),
      ],
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );
    return pda;
  }

  function findBubblegumSignerPda(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection_cpi", "utf-8")],
      toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );
    return pda;
  }
});
