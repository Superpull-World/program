import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { getAccount } from "@solana/spl-token";
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
} from "./helpers";

describe("Superpull Program - Refund Flow", () => {
  async function setupAuctionContext(): Promise<TestContext> {
    const ctx = await setupTestContext();
    await setupCollection(ctx);
    await setupMerkleTree(ctx);
    return ctx;
  }

  it("should allow refund when auction not graduated in time", async () => {
    console.log("\n🧪 TEST: Allowing refund when auction not graduated in time");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction with short deadline
    const basePrice = 1;
    const shortDeadline = 5; // 5 seconds
    await initializeAuction(ctx, basePrice, 1, 7, 5, shortDeadline);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Place bid
    console.log("\n💰 Placing bid before deadline...");
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Before Bid");
    await logBidState(ctx, bidPda, "Before Bid");
    
    await placeBid(ctx, basePrice);
    
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "After Bid");
    await logBidState(ctx, bidPda, "After Bid");
    await logAuctionState(ctx, "After Bid");

    // Wait for auction to expire
    console.log("\n⏳ Waiting for auction to expire...");
    await new Promise((resolve) => setTimeout(resolve, (shortDeadline + 1) * 1000));
    await logAuctionState(ctx, "After Expiration");

    // Attempt refund
    console.log("\n💸 Attempting refund...");
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Before Refund");
    await logBidState(ctx, bidPda, "Before Refund");

    const accounts = {
      auction: ctx.auctionPda,
      bid: bidPda,
      bidder: ctx.provider.publicKey,
      bidderTokenAccount: ctx.bidderTokenAccount,
      auctionTokenAccount: ctx.auctionTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    };

    await ctx.program.methods
      .refund()
      .accounts(accounts)
      .rpc();

    await logTokenBalances(ctx, ctx.bidderTokenAccount, "After Refund");
    await logBidState(ctx, bidPda, "After Refund");
    await logAuctionState(ctx, "After Refund");

    // Verify refund
    const finalBidState = await ctx.program.account.bidState.fetch(bidPda);
    assert.ok(finalBidState.amount.eq(new anchor.BN(0)), "Bid amount should be 0 after refund");
  });

  it("should reject refund when auction is graduated", async () => {
    console.log("\n🧪 TEST: Rejecting refund when auction is graduated");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction
    const basePrice = 1;
    const minimumItems = 3;
    await initializeAuction(ctx, basePrice, 1, 7, minimumItems);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Place bids until graduation
    for (let i = 0; i < minimumItems; i++) {
      const currentPrice = basePrice + i;
      console.log(`\n💰 Placing bid ${i + 1} of ${minimumItems} at price ${currentPrice}`);
      
      await logTokenBalances(ctx, ctx.bidderTokenAccount, `Before Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `Before Bid ${i + 1}`);
      
      await placeBid(ctx, currentPrice);
      
      await logTokenBalances(ctx, ctx.bidderTokenAccount, `After Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `After Bid ${i + 1}`);
      await logAuctionState(ctx, `After Bid ${i + 1}`);
    }

    // Verify auction is graduated
    const auctionState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
    assert.ok(auctionState.isGraduated, "Auction should be graduated");

    // Attempt refund (should fail)
    console.log("\n❌ Attempting refund on graduated auction...");
    const accounts = {
      auction: ctx.auctionPda,
      bid: bidPda,
      bidder: ctx.provider.publicKey,
      bidderTokenAccount: ctx.bidderTokenAccount,
      auctionTokenAccount: ctx.auctionTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    };

    try {
      await ctx.program.methods
        .refund()
        .accounts(accounts)
        .rpc();
      assert.fail("Should not be able to refund from graduated auction");
    } catch (error) {
      console.log("✅ Refund correctly rejected for graduated auction");
      console.log("🔍 Error:", error.toString());
    }

    // Log final states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Final State");
    await logBidState(ctx, bidPda, "Final State");
    await logAuctionState(ctx, "Final State");
  });

  it("should reject refund before deadline", async () => {
    console.log("\n🧪 TEST: Rejecting refund before deadline");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction with long deadline
    const basePrice = 1;
    const longDeadline = 3600; // 1 hour
    await initializeAuction(ctx, basePrice, 1, 7, 5, longDeadline);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Place bid
    console.log("\n💰 Placing bid...");
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Before Bid");
    await logBidState(ctx, bidPda, "Before Bid");
    
    await placeBid(ctx, basePrice);
    
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "After Bid");
    await logBidState(ctx, bidPda, "After Bid");
    await logAuctionState(ctx, "After Bid");

    // Attempt immediate refund (should fail)
    console.log("\n❌ Attempting refund before deadline...");
    const accounts = {
      auction: ctx.auctionPda,
      bid: bidPda,
      bidder: ctx.provider.publicKey,
      bidderTokenAccount: ctx.bidderTokenAccount,
      auctionTokenAccount: ctx.auctionTokenAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    };

    try {
      await ctx.program.methods
        .refund()
        .accounts(accounts)
        .rpc();
      assert.fail("Should not be able to refund before deadline");
    } catch (error) {
      console.log("✅ Refund correctly rejected before deadline");
      console.log("🔍 Error:", error.toString());
    }

    // Log final states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Final State");
    await logBidState(ctx, bidPda, "Final State");
    await logAuctionState(ctx, "Final State");
  });
}); 