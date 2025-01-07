module.exports = {
    validator: {
        killRunningValidators: true,
        accountsCluster: 'https://api.devnet.solana.com	',
        programs: [
        ],
        accounts: [
            {
                label: "Bubblegum",
                accountId: "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
                executable: true,
            },
            {
                label: "Token Metadata Program",
                accountId: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
                executable: true,
            },
            {
                label: "Token Auth Rules",
                accountId: "auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg",
                executable: true,
            },
            {
                label: "SPL Account Compression",
                accountId: "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
                executable: true
            },
            {
                label: "SPL Noop Program",
                accountId: "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
                executable: true
            },
        ],
        jsonRpcUrl: "127.0.0.1",
        websocketUrl: "127.0.0.1",
        commitment: "confirmed",
        ledgerDir: "./test-ledger",
        resetLedger: true,
        verifyFees: false,
        detached: false,
        matchFeatures: 'mainnet-beta',
    },
    relay: {
        enabled: true,
        killlRunningRelay: true,
    },
    storage: {
        enabled: true,
        storageId: "mock-storage",
        clearOnStart: true,
    },
};
