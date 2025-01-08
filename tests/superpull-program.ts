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
} from "@metaplex-foundation/mpl-token-metadata";
import { dasApi } from "@metaplex-foundation/digital-asset-standard-api";
const COMPRESSION_PROGRAM_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

describe("Superpull Program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SuperpullProgram as Program<SuperpullProgram>;
  const authority = provider.wallet as anchor.Wallet;
  console.log("connecting to umi", provider.connection.rpcEndpoint);
  const umi = createUmi(provider.connection)
    .use(keypairIdentity(fromWeb3JsKeypair(authority.payer)))
    .use(mplBubblegum())
    // .use(dasApi())
    .use(mplTokenMetadata());

  let merkleTree: Signer;
  let treeConfig: Signer;
  let auctionPda: PublicKey;
  let collectionMint: Signer;
  let treeConfigPda: PublicKey;

  const MAX_DEPTH = 14;
  const MAX_BUFFER_SIZE = 64;

  before(async () => {
    merkleTree = generateSigner(umi);
    console.log("merkleTree", merkleTree.publicKey.toString());
    treeConfig = generateSigner(umi);
    collectionMint = generateSigner(umi);

    // Calculate PDAs
    [auctionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        toWeb3JsPublicKey(merkleTree.publicKey).toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

  it("should create collection and tree", async () => {
    const [collectionMetadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        toWeb3JsPublicKey(collectionMint.publicKey).toBuffer(),
      ],
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    console.log("Creating collection");
    let collectionTx = await createNft(umi, {
      mint: collectionMint,
      name: "SuperPull Collection",
      symbol: "SPULL",
      uri: "https://assets.superpull.world/collection.json",
      sellerFeeBasisPoints: percentAmount(0),
      isCollection: true,
      creators: none(),
      collection: none(),
      uses: none(),
    });
    await collectionTx.sendAndConfirm(umi);
    console.log("Collection created");

    console.log("Delegating collection");
    const delegateCollectionTx = await delegateCollectionV1(umi, {
      mint: collectionMint.publicKey,
      delegate: fromWeb3JsPublicKey(auctionPda),
      tokenStandard: 4
    });
    await delegateCollectionTx.sendAndConfirm(umi);
    console.log("Collection delegated");

    // Create merkle tree
    console.log("Creating tree");
    const treeTx = await createTree(umi, {
      maxDepth: MAX_DEPTH,
      maxBufferSize: MAX_BUFFER_SIZE,
      public: some(true),
      merkleTree: merkleTree,
    });
    await treeTx.sendAndConfirm(umi);
    console.log("Tree created");

    // Verify tree creation
    const merkleTreeAccount = await fetchMerkleTree(umi, merkleTree.publicKey, {
      commitment: "confirmed",
    });
    const treeConfigAccount = await fetchTreeConfigFromSeeds(umi, { merkleTree: merkleTree.publicKey });
    console.log("merkleTree Details", merkleTreeAccount.publicKey, treeConfigAccount.publicKey);
    assert.ok(merkleTreeAccount);
    assert.ok(treeConfigAccount);
    treeConfigPda = toWeb3JsPublicKey(treeConfigAccount.publicKey);

    // Set tree delegate
    console.log("Setting tree delegate");
    const setTreeDelegateTx = await setTreeDelegate(umi, {
      merkleTree: merkleTreeAccount.publicKey,
      treeConfig: treeConfigAccount.publicKey,
      newTreeDelegate: fromWeb3JsPublicKey(auctionPda),
    });
    await setTreeDelegateTx.sendAndConfirm(umi);
    console.log("Tree delegate set");
  });

  it("should initialize auction", async () => {
    console.log("auctionPda", auctionPda.toString(), program.programId.toString());

    // Initialize auction
    const basePrice = new BN(1);
    const priceIncrement = new BN(1);
    const maxSupply = new BN(100);
    const minimumItems = new BN(5);

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

    console.log("Initializing auction");
    await program.methods
      .initializeAuction(basePrice, priceIncrement, maxSupply, minimumItems)
      .accounts(accounts)
      .signers([authority.payer])
      .rpc({ skipPreflight: true });

    console.log("Auction initialized");


    // Verify auction state
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    assert.ok(new BN(auctionState.basePrice).eq(basePrice));
    assert.ok(new BN(auctionState.priceIncrement).eq(priceIncrement));
    assert.ok(new BN(auctionState.maxSupply).eq(maxSupply));
    assert.ok(new BN(auctionState.minimumItems).eq(minimumItems));
    assert.ok(new BN(auctionState.currentSupply).eq(new BN(0)));
    assert.ok(new BN(auctionState.totalValueLocked).eq(new BN(0)));
    assert.ok(!auctionState.isGraduated);
  });

  it("should place bid and graduate", async () => {
    const amount = new BN(150_000); // Base price + increment

    const [collectionMetadataPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        toWeb3JsPublicKey(collectionMint.publicKey).toBuffer(),
      ],
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );
    const [collectionEditionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("edition"),
        toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
        toWeb3JsPublicKey(collectionMint.publicKey).toBuffer(),
      ],
      toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    );

    const accounts = {
      auction: auctionPda,
      bidder: authority.publicKey,
      collectionMint: toWeb3JsPublicKey(collectionMint.publicKey),
      collectionMetadata: fromWeb3JsPublicKey(collectionMetadataPda),
      collectionEdition: fromWeb3JsPublicKey(collectionEditionPda),
      collectionAuthority: fromWeb3JsPublicKey(authority.publicKey),
      collectionAuthorityRecordPda: MPL_BUBBLEGUM_PROGRAM_ID,
      merkleTree: toWeb3JsPublicKey(merkleTree.publicKey),
      treeConfig: treeConfigPda,
      treeCreator: authority.publicKey,
      bubblegumProgram: toWeb3JsPublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
      logWrapper: new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
      compressionProgram: COMPRESSION_PROGRAM_ID,
      tokenMetadataProgram: toWeb3JsPublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
      systemProgram: SystemProgram.programId,
    } as const;

    await program.methods
      .placeBid(amount)
      .accounts(accounts)
      .signers([authority.payer])
      .rpc({ skipPreflight: true });

    // Verify bid state
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    assert.ok(new BN(auctionState.currentSupply).eq(new BN(1)));
    assert.ok(new BN(auctionState.totalValueLocked).eq(amount));
  });

  it("should get current price", async () => {
    const auctionState = await program.account.auctionState.fetch(auctionPda);
    const currentPrice = new BN(auctionState.basePrice)
      .add(new BN(auctionState.priceIncrement)
        .mul(new BN(auctionState.currentSupply)));
    assert.ok(currentPrice.gt(new BN(0)));

    await program.methods
      .getCurrentPrice()
      .accounts({
        auction: auctionPda,
      })
      .rpc();
  });
});
