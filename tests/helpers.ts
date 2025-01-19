import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "bn.js";
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
  MPL_TOKEN_METADATA_PROGRAM_ID,
  mplTokenMetadata,
  findCollectionAuthorityRecordPda,
  updateV1,
  fetchMasterEditionFromSeeds,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount as createTokenAccount,
  mintTo,
  getAccount as getTokenAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// Constants
export const COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
export const NOOP_PROGRAM_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
export const MAX_DEPTH = 14;
export const MAX_BUFFER_SIZE = 64;
export const COLLECTION_NAME = "SuperPull Collection";
export const COLLECTION_SYMBOL = "SPULL";
export const COLLECTION_URI = "https://assets.superpull.world/collection.json";

// Helper Types
export interface TestContext {
  provider: anchor.AnchorProvider;
  program: Program<SuperpullProgram>;
  payer: anchor.Wallet;
  auctionCreator: anchor.web3.Keypair;
  umi: any;
  merkleTree: Signer;
  collectionMint: Signer;
  treeConfigPda: PublicKey;
  auctionPda: PublicKey;
  tokenMint: PublicKey;
  bidderTokenAccount: PublicKey;
  auctionTokenAccount: PublicKey;
}

// Setup Functions
export async function setupTestContext(): Promise<TestContext> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SuperpullProgram as Program<SuperpullProgram>;
  const payer = provider.wallet as anchor.Wallet;
  const auctionCreator = anchor.web3.Keypair.generate();

  console.log("🔌 Connecting to UMI at:", provider.connection.rpcEndpoint);
  const umi = createUmi(provider.connection)
    .use(keypairIdentity(fromWeb3JsKeypair(payer.payer)))
    .use(mplBubblegum())
    .use(mplTokenMetadata());

  const merkleTree = generateSigner(umi);
  console.log("🌳 Generated merkle tree:", merkleTree.publicKey.toString());
  const collectionMint = generateSigner(umi);

  // Calculate auction PDA
  const [auctionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), auctionCreator.publicKey.toBuffer(), toWeb3JsPublicKey(collectionMint.publicKey).toBuffer()],
    program.programId
  );
  console.log("🎯 Auction PDA:", auctionPda.toString());

  // Create token mint
  const tokenMint = await createMint(
    provider.connection,
    payer.payer,
    payer.publicKey,
    null,
    9
  );
  console.log("💰 Created token mint:", tokenMint.toString());

  // Create bidder's token account
  const bidderTokenAccount = await createTokenAccount(
    provider.connection,
    payer.payer,
    tokenMint,
    payer.publicKey
  );
  console.log("👤 Created bidder token account:", bidderTokenAccount.toString());

  // Create auction's token account
  const auctionTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    auctionPda,
    true
  );
  console.log("🎯 Auction token account address:", auctionTokenAccount.toString());

  // Create the associated token account for the auction PDA
  const ataIx = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    auctionTokenAccount,
    auctionPda,
    tokenMint
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

  const collectionAuthorityRecordPda = findCollectionAuthorityRecordPda(umi, {
    mint: collectionMint.publicKey,
    collectionAuthority: fromWeb3JsPublicKey(auctionPda),
  });

  return {
    provider,
    program,
    payer,
    auctionCreator,
    umi,
    merkleTree,
    collectionMint,
    treeConfigPda: null!, // Will be set after tree creation
    auctionPda,
    tokenMint,
    bidderTokenAccount,
    auctionTokenAccount,
  };
}

export async function setupCollection(ctx: TestContext) {
  console.log("🎨 Creating NFT collection...");
  const collectionTx = await createNft(ctx.umi, {
    mint: ctx.collectionMint,
    name: COLLECTION_NAME,
    symbol: COLLECTION_SYMBOL,
    // printSupply: printSupply("Unlimited"),
    uri: COLLECTION_URI,
    sellerFeeBasisPoints: percentAmount(0),
    isCollection: true,
    creators: none(),
    collection: none(),
    uses: none(),
  });
  await collectionTx.sendAndConfirm(ctx.umi);
  console.log("✅ Collection created successfully");

  const updateV1Tx = await updateV1(ctx.umi, {
    mint: ctx.collectionMint.publicKey,
    newUpdateAuthority:   fromWeb3JsPublicKey(ctx.auctionPda),
    // authority: fromWeb3JsPublicKey(ctx.auctionPda),
    payer: createSignerFromKeypair(ctx.umi, fromWeb3JsKeypair(ctx.payer.payer)),
  });
  await updateV1Tx.sendAndConfirm(ctx.umi);
  console.log("✅ Collection metadata updated successfully");
}

export async function setupMerkleTree(ctx: TestContext) {
  console.log("🌳 Creating merkle tree...");
  const treeTx = await createTree(ctx.umi, {
    maxDepth: MAX_DEPTH,
    maxBufferSize: MAX_BUFFER_SIZE,
    public: some(false),
    merkleTree: ctx.merkleTree,
  });
  await treeTx.sendAndConfirm(ctx.umi);
  console.log("✅ Merkle tree created successfully");
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify tree creation
  const merkleTreeAccount = await fetchMerkleTree(ctx.umi, ctx.merkleTree.publicKey, {
    commitment: "confirmed",
  });
  const treeConfigAccount = await fetchTreeConfigFromSeeds(ctx.umi, { merkleTree: ctx.merkleTree.publicKey });
  console.log("📊 Merkle Tree Details:", {
    publicKey: merkleTreeAccount.publicKey.toString(),
    configKey: treeConfigAccount.publicKey.toString()
  });

  ctx.treeConfigPda = toWeb3JsPublicKey(treeConfigAccount.publicKey);

  const setTreeDelegateTx = await setTreeDelegate(ctx.umi, {
    merkleTree: ctx.merkleTree.publicKey,
    newTreeDelegate: fromWeb3JsPublicKey(ctx.auctionPda),
  });
  await setTreeDelegateTx.sendAndConfirm(ctx.umi);
  console.log("✅ Tree delegate set successfully");
}

export async function initializeAuction(
  ctx: TestContext,
  basePrice: number = 1,
  priceIncrement: number = 1,
  maxSupply: number = 7,
  minimumItems: number = 5,
  deadlineOffset: number = 24 * 60 * 60 // 24 hours from now
) {
  console.log("🎯 Initializing auction...");

  const auctionParams = {
    basePrice: new BN(basePrice),
    priceIncrement: new BN(priceIncrement),
    maxSupply: new BN(maxSupply),
    minimumItems: new BN(minimumItems),
    deadline: new BN(Math.floor(Date.now() / 1000) + deadlineOffset)
  };

  const accounts = {
    auction: ctx.auctionPda,
    merkleTree: toWeb3JsPublicKey(ctx.merkleTree.publicKey),
    treeConfig: ctx.treeConfigPda,
    treeCreator: ctx.payer.publicKey,
    collectionMint: toWeb3JsPublicKey(ctx.collectionMint.publicKey),
    tokenMint: ctx.tokenMint,
    authority: ctx.auctionCreator.publicKey,
    payer: ctx.payer.publicKey,
    bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
    systemProgram: SystemProgram.programId,
  };

  await ctx.program.methods
    .initializeAuction(
      auctionParams.basePrice,
      auctionParams.priceIncrement,
      auctionParams.maxSupply,
      auctionParams.minimumItems,
      auctionParams.deadline
    )
    .accounts(accounts)
    .signers([ctx.payer.payer])
    .rpc({ skipPreflight: true });

  console.log("✅ Auction initialized successfully");
  return auctionParams;
}

export async function placeBid(
  ctx: TestContext,
  bidAmount: number
) {
  const [bidPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("bid"),
      ctx.auctionPda.toBuffer(),
      ctx.payer.publicKey.toBuffer(),
    ],
    ctx.program.programId
  );

  const masterEdition = await fetchMasterEditionFromSeeds(ctx.umi, { mint: ctx.collectionMint.publicKey });
  console.log("👤 Master Edition:", masterEdition);
  const collectionAuthorityRecordPda = findCollectionAuthorityRecordPda(ctx.umi, {
    mint: masterEdition.publicKey,
    collectionAuthority: fromWeb3JsPublicKey(ctx.auctionPda),
  });
  console.log("👤 Collection Authority Record PDA:", collectionAuthorityRecordPda);
  const accounts = {
    auction: ctx.auctionPda,
    bid: bidPda,
    bidder: ctx.payer.publicKey,
    payer: ctx.payer.publicKey,
    bidderTokenAccount: ctx.bidderTokenAccount,
    auctionTokenAccount: ctx.auctionTokenAccount,
    collectionMint: toWeb3JsPublicKey(ctx.collectionMint.publicKey),
    collectionMetadata: findMetadataPda(toWeb3JsPublicKey(ctx.collectionMint.publicKey)),
    collectionEdition: findEditionPda(toWeb3JsPublicKey(ctx.collectionMint.publicKey)),
    merkleTree: toWeb3JsPublicKey(ctx.merkleTree.publicKey),
    treeConfig: ctx.treeConfigPda,
    treeCreator: ctx.auctionPda,
    bubblegumSigner: findBubblegumSignerPda(),
    bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
    logWrapper: NOOP_PROGRAM_ID,
    compressionProgram: COMPRESSION_PROGRAM_ID,
    tokenMetadataProgram: toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  };

  await ctx.program.methods
    .placeBid(new BN(bidAmount))
    .accounts(accounts)
    .signers([ctx.payer.payer])
    .rpc({ skipPreflight: true });
}

// Logging Helper Functions
export async function logAuctionState(ctx: TestContext, label: string) {
  const auctionState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
  const currentPrice = auctionState.basePrice.add(
    auctionState.priceIncrement.mul(auctionState.currentSupply)
  );
  
  console.log(`\n📊 Auction State - ${label}:`, {
    authority: auctionState.authority.toString(),
    basePrice: auctionState.basePrice.toString(),
    priceIncrement: auctionState.priceIncrement.toString(),
    minimumItems: auctionState.minimumItems.toString(),
    maxSupply: auctionState.maxSupply.toString(),
    currentSupply: auctionState.currentSupply.toString(),
    totalValueLocked: auctionState.totalValueLocked.toString(),
    deadline: auctionState.deadline.toString(),
    isGraduated: auctionState.isGraduated,
    currentPrice: currentPrice.toString(),
  });
}

export async function logBidState(ctx: TestContext, bidPda: anchor.web3.PublicKey, label: string) {
  try {
    const bidState = await ctx.program.account.bidState.fetch(bidPda);
    console.log(`\n🎯 Bid State - ${label}:`, {
      auction: bidState.auction.toString(),
      bidder: bidState.bidder.toString(),
      amount: bidState.amount.toString(),
      bump: bidState.bump
    });
  } catch (error) {
    console.log(`\n🎯 Bid State - ${label}: Not found or not initialized`);
  }
}

export async function logTokenBalances(
  ctx: TestContext, 
  authorityTokenAccount: anchor.web3.PublicKey, 
  label: string
) {
  const authorityBalance = (await getTokenAccount(ctx.provider.connection, authorityTokenAccount)).amount;
  const auctionBalance = (await getTokenAccount(ctx.provider.connection, ctx.auctionTokenAccount)).amount;
  
  console.log(`\n💰 Token Balances - ${label}:`, {
    authority: authorityBalance.toString(),
    auction: auctionBalance.toString(),
  });
}

// PDA Helper Functions
export function findMetadataPda(collectionMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
      collectionMint.toBuffer(),
    ],
    toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
  );
  return pda;
}

export function findEditionPda(collectionMint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
      collectionMint.toBuffer(),
      Buffer.from("edition"),
    ],
    toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
  );
  return pda;
}

export function findBubblegumSignerPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi", "utf-8")],
    toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
  );
  return pda;
}

export function findBidPda(
  program: Program<SuperpullProgram>,
  auctionPda: PublicKey,
  bidder: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("bid"),
      auctionPda.toBuffer(),
      bidder.toBuffer(),
    ],
    program.programId
  );
}

// Account Setup Helpers
export async function createAuthorityTokenAccount(
  ctx: TestContext,
  authority: anchor.web3.Keypair | anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> {
  const authorityPubkey = authority instanceof anchor.web3.Keypair ? authority.publicKey : authority;
  const authorityTokenAccount = await createTokenAccount(
    ctx.provider.connection,
    ctx.payer.payer,
    ctx.tokenMint,
    authorityPubkey
  );
  console.log("👤 Created authority token account:", authorityTokenAccount.toString());
  return authorityTokenAccount;
}

export function getCommonAccounts(
  ctx: TestContext,
  bidPda: anchor.web3.PublicKey
) {
  return {
    auction: ctx.auctionPda,
    bid: bidPda,
    bidder: ctx.payer.publicKey,
    payer: ctx.payer.publicKey,
    bidderTokenAccount: ctx.bidderTokenAccount,
    auctionTokenAccount: ctx.auctionTokenAccount,
    collectionMint: toWeb3JsPublicKey(ctx.collectionMint.publicKey),
    collectionMetadata: findMetadataPda(toWeb3JsPublicKey(ctx.collectionMint.publicKey)),
    collectionEdition: findEditionPda(toWeb3JsPublicKey(ctx.collectionMint.publicKey)),
    collectionAuthority: fromWeb3JsPublicKey(ctx.payer.publicKey),
    merkleTree: toWeb3JsPublicKey(ctx.merkleTree.publicKey),
    treeConfig: ctx.treeConfigPda,
    treeCreator: ctx.auctionPda,
    bubblegumSigner: findBubblegumSignerPda(),
    bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
    logWrapper: NOOP_PROGRAM_ID,
    compressionProgram: COMPRESSION_PROGRAM_ID,
    tokenMetadataProgram: toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
} 