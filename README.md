# PIH website and recipient-paid airdrop

The GitHub Pages site presents the project's philosophy in English by default, with an EN/RU switch, public Ethereum distribution statistics, and a wallet claim interface. The configuration points to the deployed Ethereum faucet at `0x8F06C8DCF69B8b66DA126612b0bc1a44cc94cb51`, initially funded with 1 PIH. Its creation and runtime bytecode were verified as an exact match by Sourcify.

Deployment and funding receipts are recorded in `airdrop-deployment.json`. The faucet's public source can be inspected at https://repo.sourcify.dev/1/0x8F06C8DCF69B8b66DA126612b0bc1a44cc94cb51.

- Network: Ethereum mainnet, chain ID 1.
- Existing PIH token: `0x687FE7D7247a63E338fF7d089b9434C155B200D8` (18 decimals).
- Award: **0.000001 PIH**, exactly `1000000000000` base units.
- Each address can claim once. Multiple addresses are not treated as one person.
- The recipient pays their own transaction gas in ETH. `claim()` accepts no ETH payment and requires no approval or signature authorizing token spending.
- Funding the faucet with **1 PIH** (`1000000000000000000` base units) provides **1,000,000 claims**.
- The deployment wallet owns the faucet and can withdraw undistributed PIH using `withdraw(uint256)`.

There are no private keys, wallet passwords, signer services, or dependencies in the website files. The JavaScript reads public Ethereum RPCs and asks the visitor's wallet to sign their own claim.

## Checks

With Foundry, Solidity 0.8.26, and Node.js 22 or later:

```bash
forge test -v
node --check airdrop.js
node --test test/*.test.js
```

The Solidity checks cover exact awards, repeat-claim rejection, independent addresses, failed transfers, empty reserves, unauthorized withdrawals, and rejected ETH payments. The JavaScript checks cover transaction contents, network switching, insufficient ETH, repeat claims, rejection, pending transactions and page reloads, and failed receipts.

Additional tests cover EN/RU completeness, exact integer formatting, RPC fallback, event deduplication, reorg recovery, and retaining labeled stale statistics after an RPC failure. Existing contracts are not modified by the philosophy/statistics update.

## Public statistics and languages

`i18n.js` contains the English and Russian copy. English is used unless the visitor has explicitly saved Russian in this browser. `site.js` starts the language, claim, and statistics controllers; it requests no wallet connection until the visitor presses the connect button.

`stats.js` reads the deployed contract's `Claimed` events starting at `deploymentBlock` in `airdrop-config.json`. Claimed addresses and awarded PIH are calculated from those events, not by subtracting the remaining balance from the initial funding. PIH balance and `availableClaims()` are read at the same block (two blocks behind the current head), and the block hash is checked for consistency. The page refreshes every minute while visible and supports manual refresh. An in-memory scan cache is validated against its block hash before incremental reads. No fabricated counters or price feeds are used; an unavailable read displays no assumed values, and a failed refresh labels any retained snapshot as stale.

The page uses no third-party runtime JavaScript. A Content Security Policy permits only local scripts and the specified public Ethereum RPC endpoints. Untrusted wallet metadata, RPC results, translations, and messages are inserted as text, not HTML. Wallet claims are restricted to Ethereum and the existing `claim()` call with zero ETH value; there is no token approval request.

The language choice is stored in browser local storage; pending transaction state is stored in session storage. RPC providers receive read requests and GitHub Pages serves static files. Public wallet addresses and transactions remain visible on Ethereum.

## Publication and legal scope

See [LEGAL_REVIEW.md](LEGAL_REVIEW.md) for primary sources considered and unresolved jurisdiction-specific questions. No universal legal approval or eligibility is asserted. The operator's country and target jurisdictions must be established for a specific legal assessment; a page notice is not an enforcement mechanism. The existing on-chain contract and claim amount are unchanged.

To simulate against the real PIH token without broadcasting any mainnet transactions, start a disposable local mainnet fork and run:

```bash
anvil --fork-url https://ethereum-rpc.publicnode.com --host 127.0.0.1 --port 18545 --silent
```

In a second terminal:

```bash
python3 scripts/simulate-airdrop.py
```

The script accepts only the fixed localhost Anvil endpoint. Its temporary deployment and transfers exist only on that fork; `simulation-results.json` is not a live deployment receipt.

## Mainnet launch

Estimate gas again before launch. The owner must pay for deployment and initial funding; recipients pay subsequent claims. Do not deploy based only on a historical gas quote.

After reviewing the source and launch cost, deploy with the existing encrypted keystore. The password is entered interactively and must never be committed:

```bash
forge create contracts/PihAirdrop.sol:PihAirdrop --account pihcoin-deployer --rpc-url https://ethereum-rpc.publicnode.com --broadcast
```

Record the returned deployment address and transaction hash. Verify the deployed `TOKEN()`, `CLAIM_AMOUNT()`, and `owner()` values and publish/verify the source on a supported explorer.

Fund that exact address with 1 PIH using a separate, reviewed transfer:

```bash
cast send 0x687FE7D7247a63E338fF7d089b9434C155B200D8 'transfer(address,uint256)' DEPLOYED_FAUCET_ADDRESS 1000000000000000000 --account pihcoin-deployer --rpc-url https://ethereum-rpc.publicnode.com
```

Confirm `availableClaims()` returns `1000000`. Replace `null` in `airdrop-config.json` with the deployed faucet address, leaving the token, chain ID, and claim amount unchanged. Commit `index.html`, `airdrop.js`, `airdrop-config.json`, and the other source files to the repository's existing GitHub Pages publishing branch. No build step is required for the site.

Use a browser wallet to verify the published page's network, address, gas preview, and once-per-address status. The page must never request token approval from claimants.
