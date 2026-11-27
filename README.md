# PIH website and recipient-paid airdrop

This update adds a wallet claim interface to the existing GitHub Pages site. The configuration points to the deployed Ethereum faucet at `0x8F06C8DCF69B8b66DA126612b0bc1a44cc94cb51`, funded with 1 PIH. Its creation and runtime bytecode were verified as an exact match by Sourcify. The website update still needs to be published to GitHub Pages.

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
node --test test/airdrop.test.js
```

The Solidity checks cover exact awards, repeat-claim rejection, independent addresses, failed transfers, empty reserves, unauthorized withdrawals, and rejected ETH payments. The JavaScript checks cover transaction contents, network switching, insufficient ETH, repeat claims, rejection, pending transactions and page reloads, and failed receipts.

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
