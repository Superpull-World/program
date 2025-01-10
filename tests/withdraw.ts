import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { getAccount, createAccount as createTokenAccount } from "@solana/spl-token";
import {
  setupTestContext,
  setupCollection,
  setupMerkleTree,
  initializeAuction,
  placeBid,
  TestContext,
  logAuctionState,
  logBidState,
  logTokenBalances,
  findBidPda,
  createAuthorityTokenAccount,
} from "./helpers";

describe("Superpull Program - Withdraw Flow", () => {
  async function setupAuctionContext(): Promise<TestContext> {
    const ctx = await setupTestContext();
    await setupCollection(ctx);
    await setupMerkleTree(ctx);
    return ctx;
  }

  it("should allow authority to withdraw after graduation", async () => {
    console.log("\n🧪 TEST: Allowing authority to withdraw after graduation");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction
    const basePrice = 1;
    const minimumItems = 3;
    await initializeAuction(ctx, basePrice, 1, 7, minimumItems);
    await logAuctionState(ctx, "After Initialization");

    // Create authority's token account
    const authorityTokenAccount = await createAuthorityTokenAccount(ctx, ctx.auctionCreator);

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Place bids until graduation
    for (let i = 0; i < minimumItems; i++) {
      const currentPrice = basePrice + i;
      console.log(`\n💰 Placing bid ${i + 1} of ${minimumItems} at price ${currentPrice}`);
      
      await logTokenBalances(ctx, authorityTokenAccount, `Before Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `Before Bid ${i + 1}`);
      
      await placeBid(ctx, currentPrice);
      
      await logTokenBalances(ctx, authorityTokenAccount, `After Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `After Bid ${i + 1}`);
      await logAuctionState(ctx, `After Bid ${i + 1}`);
    }

    // Verify auction is graduated
    const auctionState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
    assert.ok(auctionState.isGraduated, "Auction should be graduated");
    assert.ok(auctionState.totalValueLocked.gt(new anchor.BN(0)), "Must have funds to withdraw");

    // Attempt withdrawal
    console.log("\n💸 Attempting withdrawal...");
    await logTokenBalances(ctx, authorityTokenAccount, "Before Withdrawal");
    await logAuctionState(ctx, "Before Withdrawal");

    const accounts = {
      auction: ctx.auctionPda,
      authority: ctx.auctionCreator.publicKey,
      authorityTokenAccount: authorityTokenAccount,
      auctionTokenAccount: ctx.auctionTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    };

    await ctx.program.methods
      .withdraw()
      .accounts(accounts)
      .rpc();

    // Log final states
    await logTokenBalances(ctx, authorityTokenAccount, "After Withdrawal");
    await logAuctionState(ctx, "After Withdrawal");

    // Verify final state
    const finalState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
    assert.ok(finalState.totalValueLocked.eq(new anchor.BN(0)), "Total value locked should be 0 after withdrawal");
  });

  it("should reject withdrawal when auction not graduated", async () => {
    console.log("\n🧪 TEST: Rejecting withdrawal when auction not graduated");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction
    const basePrice = 1;
    const minimumItems = 3;
    await initializeAuction(ctx, basePrice, 1, 7, minimumItems);
    await logAuctionState(ctx, "After Initialization");

    // Create authority's token account
    const authorityTokenAccount = await createAuthorityTokenAccount(ctx, ctx.auctionCreator);

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Place bids until graduation
    for (let i = 0; i < minimumItems -1; i++) {
      const currentPrice = basePrice + i;
      console.log(`\n💰 Placing bid ${i + 1} of ${minimumItems} at price ${currentPrice}`);
      
      await logTokenBalances(ctx, authorityTokenAccount, `Before Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `Before Bid ${i + 1}`);
      
      await placeBid(ctx, currentPrice);
      
      await logTokenBalances(ctx, authorityTokenAccount, `After Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `After Bid ${i + 1}`);
      await logAuctionState(ctx, `After Bid ${i + 1}`);
    }

    // Verify auction is graduated
    const auctionState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
    assert.ok(!auctionState.isGraduated, "Auction should not be graduated");

    // Attempt withdrawal (should fail)
    console.log("\n❌ Attempting withdrawal before graduation...");
    const accounts = {
      auction: ctx.auctionPda,
      authority: ctx.auctionCreator.publicKey,
      authorityTokenAccount: authorityTokenAccount,
      auctionTokenAccount: ctx.auctionTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    };

    try {
      await ctx.program.methods
        .withdraw()
        .accounts(accounts)
        .rpc();
      assert.fail("Should not be able to withdraw before graduation");
    } catch (error) {
      console.log("✅ Withdrawal correctly rejected before graduation");
      console.log("🔍 Error:", error.toString());
    }

    // Log final states
    await logTokenBalances(ctx, authorityTokenAccount, "Final State");
    await logAuctionState(ctx, "Final State");
  });

  it("should reject withdrawal from non-authority", async () => {
    console.log("\n🧪 TEST: Rejecting withdrawal from non-authority");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction
    const basePrice = 1;
    const minimumItems = 3;
    await initializeAuction(ctx, basePrice, 1, 7, minimumItems);
    await logAuctionState(ctx, "After Initialization");

    // Create authority's token account
    const authorityTokenAccount = await createAuthorityTokenAccount(ctx, ctx.auctionCreator);
    console.log("👤 Real Authority Token Account:", authorityTokenAccount.toString());

    // Create fake authority's token account
    const fakeAuthority = anchor.web3.Keypair.generate();
    const fakeAuthorityTokenAccount = await createAuthorityTokenAccount(ctx, fakeAuthority);
    console.log("👤 Fake Authority Token Account:", fakeAuthorityTokenAccount.toString());

    // Place bids until graduation
    for (let i = 0; i < minimumItems; i++) {
      const currentPrice = basePrice + i;
      console.log(`\n💰 Placing bid ${i + 1} of ${minimumItems} at price ${currentPrice}`);
      await placeBid(ctx, currentPrice);
      await logAuctionState(ctx, `After Bid ${i + 1}`);
    }

    // Verify auction is graduated
    const auctionState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
    assert.ok(auctionState.isGraduated, "Auction should be graduated");

    // Attempt withdrawal with fake authority (should fail)
    console.log("\n❌ Attempting withdrawal with fake authority...");
    const accounts = {
      auction: ctx.auctionPda,
      authority: fakeAuthority.publicKey,
      authorityTokenAccount: fakeAuthorityTokenAccount,
      auctionTokenAccount: ctx.auctionTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    };

    try {
      await ctx.program.methods
        .withdraw()
        .accounts(accounts)
        .signers([fakeAuthority])
        .rpc();
      assert.fail("Should not allow withdrawal from non-authority");
    } catch (error) {
      console.log("✅ Withdrawal correctly rejected for non-authority");
      console.log("🔍 Error:", error.toString());
    }

    // Log final states
    await logTokenBalances(ctx, authorityTokenAccount, "Real Authority Final State");
    await logTokenBalances(ctx, fakeAuthorityTokenAccount, "Fake Authority Final State");
    await logAuctionState(ctx, "Final State");
  });
}); 