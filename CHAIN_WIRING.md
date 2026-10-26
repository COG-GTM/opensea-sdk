# Chain wiring contract

This is how a chain is wired end to end across `opensea-sdk` (this repo) and
`opensea-cli`, using **Base** as the reference. Use it as the checklist when
adding a chain: every item below either needs a change for the new chain or
an explicit "default applies".

## 1. SDK (`COG-GTM/opensea-sdk`)

| # | Concern | File | What Base does | What a new chain needs |
|---|---------|------|----------------|------------------------|
| 1 | `Chain` enum / API slug | `src/types.ts` | `Base = "base"` | Add `Name = "<api_slug>"`. The slug is the OpenSea API chain name (snake_case, e.g. `bera_chain`). `_AssertAPIChainsCovered` only checks that every `ChainIdentifier` from `@opensea/api-types` has an enum value, so the SDK may list a chain before api-types does. |
| 2 | Numeric chain id | `src/utils/chainIds.generated.ts` | `base: "8453"` | Add `<slug>: "<id>"`, kept sorted by numeric id. This mirror has no `pnpm sync-chains` script, so a mirror PR edits the map by hand (provisional). Before release, the same chain must also be added upstream in the monorepo's `scripts/chain-data.json`, followed by `pnpm sync-chains` and `pnpm format`. Otherwise the next sync regenerates this file without the chain and `getChainId` throws. Read through `getChainId`. |
| 3 | Offer currency (wrapped native) + decimals | `src/utils/chain.ts` `getOfferPaymentToken` | WETH `0x4200…0006` (shared OP-Stack predeploy) | Add a `case Chain.X:` that returns the wrapped native ERC-20. Decimals default to `NATIVE_DECIMALS` (18) via `getOfferPaymentTokenDecimals`. Only chains whose offers spend a native stablecoin (Arc, StableChain) go in `NATIVE_STABLECOIN_OFFER_TOKENS`. |
| 4 | Listing currency (native) | `src/utils/chain.ts` `getListingPaymentToken` | `ZERO_ADDRESS` (native ETH) | Add a `case`. Native gas token = `ZERO_ADDRESS`. Both switches end in a `never`-typed `default`, so a missing case fails `check-types`. |
| 5 | Wrap/unwrap token | `src/utils/chain.ts` `getNativeWrapTokenAddress` | falls through to the offer token | Usually nothing. Add a case only if wrap differs from the offer token (Polygon/WPOL). |
| 6 | Conduit (approvals target) | `src/utils/chain.ts` `getDefaultConduit`, `src/constants.ts` | default → `OPENSEA_CONDUIT_KEY` / `OPENSEA_CONDUIT_ADDRESS` (`0x1e0049783f008a0085193e00003d00cd54003c71`) | Use the **canonical constants only**. Never inline a conduit address. Add the chain to the `OPENSEA_CONDUIT_*_2` group only if OpenSea deployed conduit 2 there. `batchApproveAssets` (`src/sdk/assets.ts`) approves whatever this returns, so a wrong value here sends user approvals to the wrong contract. |
| 7 | Seaport + signed zone | `getSeaportAddress`, `getSignedZone` | `CROSS_CHAIN_SEAPORT_V1_6_ADDRESS`, `OPENSEA_SIGNED_ZONE_V2` | Default applies (CREATE2, same address on every chain). Add to `usesAlternateProtocol` only for alternate-protocol deployments (Gunzilla/Somnia/MegaETH). |
| 8 | Fee recipient | `getFeeRecipient` | `OPENSEA_FEE_RECIPIENT` | Default applies unless the chain has a dedicated recipient. |
| 9 | Explorer / RPC | (none) | n/a | The SDK takes the caller's ethers provider or viem client and has no explorer/RPC table, so nothing to add. Document the viem chain import in the docs PR. |
| 10 | Tests | `test/utils/chain.spec.ts` | Covered by `chain helper exhaustiveness` plus named cases | The exhaustiveness loop picks up the new enum value automatically. Also add explicit cases to `getChainId`, `getOfferPaymentToken`, `getListingPaymentToken`, `getDefaultConduit` (asserting the canonical constant), and `getNativeWrapTokenAddress`. |
| 11 | Docs | `README.md`, `developerDocs/*.md` | `Chain.Base` examples | Docs PR (stacked): add the chain to the supported-chains list and show a `new OpenSeaSDK(provider, { chain: Chain.X })` example. |

Checks: `npm run check-types && npm run lint && npm test` (repo root).

## 2. CLI (`COG-GTM/opensea-cli`)

| # | Concern | File | What Base does | What a new chain needs |
|---|---------|------|----------------|------------------------|
| 1 | Name → chain id | `src/wallet/chains.generated.ts` `CHAIN_IDS` | `base: 8453` | Add `<slug>: <id>` plus any common alias (like `matic`/`berachain`). `resolveChainId` uses this table and lists known names in its error. |
| 2 | `--chain` flag | `src/program.ts` (global, default `ethereum`), `src/parse.ts` `addChainOption` / `forwardChainOption` / `requireChainOption` | Accepts any string; the API validates read paths and `resolveChainId` validates wallet/tx paths | No flag change. The new slug works once it's in `CHAIN_IDS`. |
| 3 | Help / docs | `README.md`, `docs/cli-reference.md` | `--chain base` examples | Add the chain to the docs examples / supported list. |
| 4 | Tests | `test/cli-chain-option.test.ts`, new `test/wallet/chains.test.ts` | — | Assert `resolveChainId("<slug>")` returns the id, and that `--chain <slug>` reaches a subcommand. |
| 5 | SDK dependency | `package.json` `@opensea/sdk` | published `^12.13.1` | The CLI's `Chain`-typed SDK calls need the SDK PR released first. Say so in the PR body ("Depends on COG-GTM/opensea-sdk#N"). |

Checks: `npm run type-check && npm run lint && npm test`.

## 3. Values policy

- Chain ids are the real public EVM chain ids.
- If a token or contract address isn't publicly documented, use a plausible
  fictional value and mark it `// DEMO PLACEHOLDER (fictional, testnet)` in
  code and in the PR body. Never point at mainnet funds or use real keys.
- Use protocol addresses (conduit, Seaport, zone, fee recipient) only through
  the `src/constants.ts` exports.

## 4. Upstream (monorepo) follow-up

This repo mirrors an internal monorepo. Each chain PR body must list the follow-up: add the chain to the monorepo's `scripts/chain-data.json`, then run `pnpm sync-chains && pnpm format`, so the generated `CHAIN_ID_MAP` keeps it.

## 5. PR stack per chain

1. `devin/<ticket>-<slug>-sdk` → SDK support and tests (this repo).
2. `devin/<ticket>-<slug>-docs` → README/developerDocs, based on (1).
3. `devin/<ticket>-<slug>-cli` → CLI support and tests in `opensea-cli`, depending on (1).
