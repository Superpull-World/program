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

describe("Superpull Program - Bid Flow", () => {
  async function setupAuctionContext(): Promise<TestContext> {
    const ctx = await setupTestContext();
    await setupCollection(ctx);
    await setupMerkleTree(ctx);
    return ctx;
  }

  it("should place bid successfully", async () => {
    console.log("\n🧪 TEST: Placing a successful bid");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction
    const basePrice = 1;
    await initializeAuction(ctx, basePrice);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);
    await logBidState(ctx, bidPda, "Before Bid");
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Before Bid");

    // Place bid
    await placeBid(ctx, basePrice);
    
    // Log all states after bid
    await logBidState(ctx, bidPda, "After Bid");
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "After Bid");
    await logAuctionState(ctx, "After Bid");

    // Verify auction state
    const auctionState = await ctx.program.account.auctionState.fetch(ctx.auctionPda);
    assert.ok(auctionState.currentSupply.eq(new anchor.BN(1)), "Current supply should be 1");
    assert.ok(auctionState.totalValueLocked.eq(new anchor.BN(basePrice)), "Total value locked should match bid");
  });

  it("should reject bids after reaching max supply", async () => {
    console.log("\n🧪 TEST: Rejecting bids after reaching max supply");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction with small max supply
    const basePrice = 1;
    const maxSupply = 3;
    const minimumItems = 2;
    await initializeAuction(ctx, basePrice, 1, maxSupply, minimumItems);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Place bids until max supply
    for (let i = 0; i < maxSupply; i++) {
      const currentPrice = basePrice + i;
      console.log(`\n🎯 Attempting bid ${i + 1} of ${maxSupply} at price ${currentPrice}`);
      
      await logTokenBalances(ctx, ctx.bidderTokenAccount, `Before Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `Before Bid ${i + 1}`);
      
      await placeBid(ctx, currentPrice);
      
      await logTokenBalances(ctx, ctx.bidderTokenAccount, `After Bid ${i + 1}`);
      await logBidState(ctx, bidPda, `After Bid ${i + 1}`);
      await logAuctionState(ctx, `After Bid ${i + 1}`);
    }

    // Attempt to place one more bid (should fail)
    console.log("\n❌ Attempting to exceed max supply...");
    try {
      await placeBid(ctx, basePrice + maxSupply);
      assert.fail("Should not be able to place bid after reaching max supply");
    } catch (error) {
      console.log("✅ Bid correctly rejected after reaching max supply");
      console.log("🔍 Error:", error.toString());
    }

    // Log final states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Final State");
    await logBidState(ctx, bidPda, "Final State");
    await logAuctionState(ctx, "Final State");
  });

  it("should reject bids when auction is expired", async () => {
    console.log("\n🧪 TEST: Rejecting bids when auction is expired");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction with very short deadline
    const shortDeadline = 5; // 5 seconds
    await initializeAuction(ctx, 1, 1, 7, 5, shortDeadline);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Log initial states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Initial State");
    await logBidState(ctx, bidPda, "Initial State");

    // Wait for auction to expire
    console.log("\n⏳ Waiting for auction to expire...");
    await new Promise((resolve) => setTimeout(resolve, (shortDeadline + 1) * 1000));
    await logAuctionState(ctx, "After Expiration");

    // Attempt to place bid (should fail)
    try {
      await placeBid(ctx, 1);
      assert.fail("Should not be able to place bid after deadline");
    } catch (error) {
      console.log("✅ Bid correctly rejected after deadline");
      console.log("🔍 Error:", error.toString());
    }

    // Log final states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Final State");
    await logBidState(ctx, bidPda, "Final State");
    await logAuctionState(ctx, "Final State");
  });

  it("should reject bids below current price", async () => {
    console.log("\n🧪 TEST: Rejecting bids below current price");
    // Setup fresh context for this test
    const ctx = await setupAuctionContext();

    // Initialize auction with base price 10
    const basePrice = 10;
    const priceIncrement = 5;
    await initializeAuction(ctx, basePrice, priceIncrement);
    await logAuctionState(ctx, "After Initialization");

    // Find bid PDA
    const [bidPda] = findBidPda(ctx.program, ctx.auctionPda, ctx.provider.publicKey);

    // Log initial states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Initial State");
    await logBidState(ctx, bidPda, "Initial State");

    // Place first bid at base price
    console.log("\n💰 Placing first bid at base price...");
    await placeBid(ctx, basePrice);
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "After First Bid");
    await logBidState(ctx, bidPda, "After First Bid");
    await logAuctionState(ctx, "After First Bid");

    // Try to place second bid at same price (should fail)
    console.log("\n❌ Attempting bid at same price...");
    try {
      await placeBid(ctx, basePrice);
      assert.fail("Should not be able to place bid below current price");
    } catch (error) {
      console.log("✅ Bid correctly rejected for being at same price");
      console.log("🔍 Error:", error.toString());
    }

    // Try to place bid below base price + increment
    console.log("\n❌ Attempting bid below price increment...");
    try {
      await placeBid(ctx, basePrice + 2);
      assert.fail("Should not be able to place bid below current price + increment");
    } catch (error) {
      console.log("✅ Bid correctly rejected for being below price increment");
      console.log("🔍 Error:", error.toString());
    }

    // Place successful bid at correct price
    console.log("\n💰 Placing bid at correct price...");
    await placeBid(ctx, basePrice + priceIncrement);
    
    // Log final states
    await logTokenBalances(ctx, ctx.bidderTokenAccount, "Final State");
    await logBidState(ctx, bidPda, "Final State");
    await logAuctionState(ctx, "Final State");
  });
}); 