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
  const authority = provider.wallet as anchor.Wallet;
  
  console.log("🔌 Connecting to UMI at:", provider.connection.rpcEndpoint);
  const umi = createUmi(provider.connection)
    .use(keypairIdentity(fromWeb3JsKeypair(authority.payer)))
    .use(mplBubblegum())
    .use(mplTokenMetadata());

  let merkleTree: Signer;
  let auctionPda: PublicKey;
  let collectionMint: Signer;
  let treeConfigPda: PublicKey;
  let collectionAuthorityRecordPda: Pda;

  before(async () => {
    console.log("📦 Setting up test environment...");
    merkleTree = generateSigner(umi);
    console.log("🌳 Generated merkle tree:", merkleTree.publicKey.toString());
    collectionMint = generateSigner(umi);

    // Calculate PDAs
    const pdas = createProgramPDAs(merkleTree, authority, program.programId);
    auctionPda = pdas.auctionPda;
    
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
      payer: createSignerFromKeypair(umi, fromWeb3JsKeypair(authority.payer)),
      updateAuthority: createSignerFromKeypair(umi, fromWeb3JsKeypair(authority.payer)),
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
      maxSupply: new BN(100),
      minimumItems: new BN(5)
    };

    const accounts = {
      auction: auctionPda,
      merkleTree: toWeb3JsPublicKey(merkleTree.publicKey),
      treeConfig: treeConfigPda,
      treeCreator: authority.publicKey,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      authority: authority.publicKey,
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
      .signers([authority.payer])
      .rpc({ skipPreflight: true });

    console.log("✅ Auction initialized successfully");

    // Verify auction state
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    console.log("📊 Auction State:", {
      basePrice: auctionState.basePrice.toString(),
      priceIncrement: auctionState.priceIncrement.toString(),
      maxSupply: auctionState.maxSupply.toString(),
      currentSupply: auctionState.currentSupply.toString(),
      totalValueLocked: auctionState.totalValueLocked.toString(),
      isGraduated: auctionState.isGraduated
    });

    // Assertions with descriptive messages
    assert.ok(new BN(auctionState.basePrice).eq(auctionParams.basePrice), "Base price should match");
    assert.ok(new BN(auctionState.priceIncrement).eq(auctionParams.priceIncrement), "Price increment should match");
    assert.ok(new BN(auctionState.maxSupply).eq(auctionParams.maxSupply), "Max supply should match");
    assert.ok(new BN(auctionState.minimumItems).eq(auctionParams.minimumItems), "Minimum items should match");
    assert.ok(new BN(auctionState.currentSupply).eq(new BN(0)), "Initial supply should be 0");
    assert.ok(new BN(auctionState.totalValueLocked).eq(new BN(0)), "Initial TVL should be 0");
    assert.ok(!auctionState.isGraduated, "Auction should not be graduated initially");
  });

  it("should place bid and graduate", async () => {
    console.log("💰 Placing bid...");
    const bidAmount = new BN(150_000); // Base price + increment

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
      bidder: authority.publicKey,
      payer: authority.publicKey,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      collectionMetadata: findMetadataPda(),
      collectionEdition: findEditionPda(),
      collectionAuthority: fromWeb3JsPublicKey(authority.publicKey),
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
      .signers([authority.payer])
      .rpc({ skipPreflight: true });

    console.log("✅ Bid placed successfully");
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
