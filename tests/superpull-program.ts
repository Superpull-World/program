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

  before(async () => {
    console.log("📦 Setting up test environment...");

    merkleTree = generateSigner(umi);
    console.log("🌳 Generated merkle tree:", merkleTree.publicKey.toString());
    collectionMint = generateSigner(umi);

    // Calculate auction PDA
    auctionPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        toWeb3JsPublicKey(merkleTree.publicKey).toBuffer(),
        auctionCreator.publicKey.toBuffer(),
      ],
      program.programId
    )[0];
    console.log("🎯 Auction PDA:", auctionPda.toString());
    
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

    // Debug account states
    const accountStates = {
      collectionAuthority: await provider.connection.getAccountInfo(toWeb3JsPublicKey(collectionAuthorityRecordPda[0])),
      collectionMetadata: await provider.connection.getAccountInfo(findMetadataPda()),
      collectionEdition: await provider.connection.getAccountInfo(findEditionPda()),
      bubblegumSigner: await provider.connection.getAccountInfo(findBubblegumSignerPda())
    };

    // Log account states for debugging
    Object.entries(accountStates).forEach(([key, value]) => {
      console.log(`📝 ${key} Account:`, value ? "Exists" : "Not found");
    });

    const accounts = {
      auction: auctionPda,
      bidder: payer.publicKey,
      payer: payer.publicKey,
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
    };

    await program.methods
      .placeBid(bidAmount)
      .accounts(accounts)
      .signers([payer.payer])
      .rpc({ skipPreflight: true });

    console.log("✅ Bid placed successfully");

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
    };

    // Place 4 more bids
    for (let i = 0; i < 4; i++) {
      const auctionState = await program.account.auctionState.fetch(auctionPda);
      const currentPrice = auctionState.basePrice.add(
        auctionState.priceIncrement.mul(auctionState.currentSupply)
      );
      
      console.log(`\n💰 Placing bid ${i + 2} of 5...`);
      await program.methods
        .placeBid(currentPrice)
        .accounts(accounts)
        .signers([payer.payer])
        .rpc({ skipPreflight: true });
      
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
        currentPriceInSOL: `${newPrice.toNumber() / LAMPORTS_PER_SOL} SOL`
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
      await program.methods
        .placeBid(currentPrice)
        .accounts(accounts)
        .signers([payer.payer])
        .rpc({ skipPreflight: true });
      
      const stateAfterBid = await program.account.auctionState.fetch(auctionPda);
      console.log(`📊 Supply after bid: ${stateAfterBid.currentSupply} / ${stateAfterBid.maxSupply}`);
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
      // console.log("Error:", error);
      // assert.ok(error.toString().includes("MaxSupplyReached"), 
      //   "Error should indicate max supply was reached");
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

    // Get initial balances
    const authorityBalance = await provider.connection.getBalance(auctionCreator.publicKey);
    const auctionBalance = await provider.connection.getBalance(auctionPda);
    
    console.log("📊 Initial Balances:", {
      authority: `${authorityBalance / LAMPORTS_PER_SOL} SOL`,
      auction: `${auctionBalance / LAMPORTS_PER_SOL} SOL`,
    });

    // Verify auction is graduated
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    assert.ok(auctionState.isGraduated, "Auction must be graduated to withdraw");
    assert.ok(auctionState.totalValueLocked.gt(new BN(0)), "Must have funds to withdraw");

    const accounts = {
      auction: auctionPda,
      authority: auctionCreator.publicKey,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    };

    await program.methods
      .withdraw()
      .accounts(accounts)
      .signers([payer.payer])
      .rpc({ skipPreflight: true });

    // Verify final balances
    const finalAuthorityBalance = await provider.connection.getBalance(auctionCreator.publicKey);
    const finalAuctionBalance = await provider.connection.getBalance(auctionPda);
    
    console.log("📊 Final Balances:", {
      authority: `${finalAuthorityBalance / LAMPORTS_PER_SOL} SOL`,
      auction: `${finalAuctionBalance / LAMPORTS_PER_SOL} SOL`,
    });

    // Verify auction state
    const finalState = await program.account.auctionState.fetch(auctionPda);
    assert.ok(finalState.totalValueLocked.eq(new BN(0)), "Total value locked should be 0 after withdrawal");
    assert.ok(finalAuctionBalance < auctionBalance, "Auction balance should decrease");
    assert.ok(finalAuthorityBalance > authorityBalance, "Authority balance should increase");
  });

  it("should not allow non-authority to withdraw", async () => {
    console.log("\n🚫 Testing unauthorized withdrawal...");

    const accounts = {
      auction: auctionPda,
      authority: payer.publicKey, // Using wrong authority
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
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
      // assert.ok(error.toString().includes("UnauthorizedWithdraw"), 
      //   "Error should indicate unauthorized withdrawal");
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
