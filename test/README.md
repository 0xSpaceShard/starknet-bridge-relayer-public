# Process to run e2e tests

1. Start the relayer using `make dev-build` and then `make dev-up`.
2. Set to a high value `FIRST_BLOCK=999990000`, this will prevent the indexer to index the mainnet blocks.
3. Use the data provided to generate the message hashes and submit them on-chain.
4. Use the data provided to recover the database.
5. Check if the messages were consumed by the relayer.
