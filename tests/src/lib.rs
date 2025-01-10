use anchor_lang::AccountDeserialize;
use solana_program::instruction::Instruction;
use solana_program_test::{processor, tokio, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
  account::AccountSharedData, pubkey::Pubkey, signature::Keypair, signer::Signer,
  transaction::Transaction,
};
#[tokio::test]
async fn test_program() {
    let mut validator = ProgramTest::default();
    validator.add_program("superpull_program", superpull_program::ID, processor!(superpull_program::entry));
}