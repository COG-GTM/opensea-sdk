# CHAIN_WIRING.md — adding a chain to the SDK and CLI

This checklist is derived from how **Base** (`Chain.Base = "base"`, chain id `8453`) is wired today in
`COG-GTM/opensea-sdk` and `COG-GTM/opensea-cli`. Follow every step for a new chain `<slug>`.
Work in three PRs: **PR1 SDK + tests** (off `main`), **PR2 docs/README** (stacked on PR1),
**PR3 CLI + tests** (in `opensea-cli`, body says it depends on PR1).

## 0. Facts to collect first (and how to verify them)

| Fact | Base value | Where it is used |
|---|---|---|
| API slug | `base` | `Chain` enum value, CLI `CHAIN_IDS` key |
| EVM chain id | `8453` | `CHAIN_ID_MAP` (SDK), `CHAIN_IDS` (CLI) |
| Native currency + decimals | ETH, 18 | `getListingPaymentToken` returns `ZERO_ADDRESS`; `NATIVE_DECIMALS` |
| Wrapped native token | WETH `0x4200000000000000000000000000000000000006` | `getOfferPaymentToken`, `getNativeWrapTokenAddress` |
| Seaport / conduit / zone / fee recipient | canonical (`CROSS_CHAIN_SEAPORT_V1_6_ADDRESS`, `OPENSEA_CONDUIT_KEY/ADDRESS`, `OPENSEA_SIGNED_ZONE_V2`, `OPENSEA_FEE_RECIPIENT`) | `getSeaportAddress`, `getDefaultConduit`, `getSignedZone`, `getFeeRecipient` |

Rules:
- The chain id must be the real one. Verify it read-only with a public RPC: `eth_chainId`.
- Every token the SDK approves or pays with must be a real, documented contract. Verify read-only:
  `eth_getCode` is non-empty, `symbol()` / `decimals()` match the docs. Cite the doc link in the PR body.
- If a token cannot be verified, **leave it out** so the helper throws, and say so in the PR body.
- Never invent addresses in `src/`. Fictional values are allowed only in tests, mocks and docs
  examples and must be marked `DEMO PLACEHOLDER`.
- Only read-only RPC calls (no transactions, no keys).

## 1. SDK (`COG-GTM/opensea-sdk`)

1. **`Chain` enum** — `src/types.ts`. Add `<PascalName> = "<slug>"`. The value is the OpenSea API
   chain identifier (snake_case, e.g. `bera_chain`). The compile-time check
   `_AssertAPIChainsCovered` only requires `ChainIdentifier ⊆ Chain`, so a slug not yet in the API
   spec still compiles.
2. **Chain id map** — `src/utils/chainIds.generated.ts` `CHAIN_ID_MAP`. Add `"<slug>": "<id>"`,
   keeping entries sorted by numeric id. `getChainId()` in `src/utils/chain.ts` reads this map.
   The source of truth is upstream: the private monorepo generates this file from
   `scripts/chain-data.json` with `pnpm sync-chains` (+ `pnpm format`), per `AGENTS.md`. Neither
   exists in this fork, so fork PRs edit the generated file by hand in the same format **and** the
   PR body must say the chain also needs a `scripts/chain-data.json` entry upstream; otherwise the
   next sync drops it and `getChainId()` throws for the chain.
3. **Payment tokens** — `src/utils/chain.ts` (both `switch`es are exhaustive; a missing case throws
   `Unknown chain`):
   - `getListingPaymentToken`: the default listing currency, which is not always the gas asset.
     Base returns `ZERO_ADDRESS` (native ETH, grouped under `// ETH`), but some chains list in a
     wrapped token (e.g. Polygon returns WETH). Decide the listing currency per chain, verify it
     like any other token, and add a comment naming it (e.g. `// xDAI`). Use `ZERO_ADDRESS` only
     when listings are priced in the native gas asset.
   - `getOfferPaymentToken`: the wrapped native token. OP-stack chains share
     `0x4200000000000000000000000000000000000006`; add the case to that group. Otherwise add a new
     case with a `// W<SYMBOL>` comment.
   - `getNativeWrapTokenAddress`: defaults to the offer token. Only add a case if the offer token is
     not the wrapped native asset (Polygon pattern). Native-stablecoin chains use
     `NATIVE_STABLECOIN_OFFER_TOKENS` instead (Arc/StableChain pattern) and throw here.
4. **Decimals** — `getOfferPaymentTokenDecimals` / `getDefaultPaymentTokenDecimals` return
   `NATIVE_DECIMALS` (18) unless the chain is in `NATIVE_STABLECOIN_OFFER_TOKENS`. Confirm the
   wrapped token reports `decimals() == 18`; otherwise model it like the stablecoin map.
5. **Seaport / conduit / zone / fee** — `src/utils/chain.ts`:
   - `getDefaultConduit`: Base uses `OPENSEA_CONDUIT_KEY` + `OPENSEA_CONDUIT_ADDRESS`
     (`0x1e0049783f008a0085193e00003d00cd54003c71`) from `src/constants.ts`. New chains use those
     constants by reference — never paste a literal conduit address. Only chains listed in the
     `OPENSEA_CONDUIT_*_2` branch or `usesAlternateProtocol()` differ.
   - `getSeaportAddress` → `CROSS_CHAIN_SEAPORT_V1_6_ADDRESS`, `getSignedZone` →
     `OPENSEA_SIGNED_ZONE_V2`, `getFeeRecipient` → `OPENSEA_FEE_RECIPIENT` unless the chain is an
     alternate-protocol chain.
   - These addresses are consumed by `src/sdk.ts` (ethers) and `src/viem.ts` (viem) when building
     `Seaport` (`conduitKeyToConduit` + `defaultConduitKey`), and by `src/sdk/assets.ts`
     `batchApproveAssets` / `checkAssetApproval`, which approve the default conduit as spender.
     A wrong conduit means approvals go to the wrong contract.
   - Report in the PR body whether Seaport 1.6, the conduit and the signed zone have code on the
     chain (`eth_getCode`), so reviewers know if orders can settle there today.
6. **Tests** — `test/utils/chain.spec.ts`:
   - The exhaustiveness loops over `Object.values(Chain)` pick the chain up automatically; add it to
     `SEAPORT_UNSUPPORTED_CHAINS` / `NO_WRAP_TOKEN_CHAINS` / `NO_CHAIN_ID_CHAINS` only if it
     genuinely belongs there.
   - Add `[Chain.<Name>, "<id>"]` to the `getChainId` table.
   - Add explicit assertions for `getListingPaymentToken`, `getOfferPaymentToken`,
     `getNativeWrapTokenAddress`, `getDefaultConduit` (expect `OPENSEA_CONDUIT_KEY` /
     `OPENSEA_CONDUIT_ADDRESS`), `getSeaportAddress`, `getSignedZone`, `getFeeRecipient`.
7. **Checks** (all must pass): `npm install`, `npm run check-types`, `npm run lint`, `npm test`.
   Do not commit `package-lock.json` churn from `npm install`.

## 2. SDK docs (PR2, stacked on PR1)

- `README.md` and `developerDocs/` reference chains through `Chain.<Name>` examples (Base:
  `README.md` cross-chain drop example, `developerDocs/api-reference.md`). Add a short example or
  supported-chain note for the new chain; `developerDocs/faq.md` points at the `Chain` enum as the
  source of truth.
- Any fictional address/collection in examples must be marked `DEMO PLACEHOLDER`.

## 3. CLI (`COG-GTM/opensea-cli`, PR3)

1. **Chain id table** — `src/wallet/chains.generated.ts` `CHAIN_IDS`. Add `<slug>: <id>`, sorted
   by id; optional aliases follow the existing pattern (`mainnet`, `matic`, `apechain`,
   `berachain`). `resolveChainId()` accepts a number, numeric string, or known name and throws
   `Unknown chain "<x>". Pass a numeric chain ID or use a known name: ...` otherwise. It is
   re-exported from `src/wallet/chains.ts`, `src/wallet/index.ts`, `src/index.ts` and used by
   `src/sdk.ts` to sign API-built transactions.
2. **`--chain` flag** — `src/program.ts` global `--chain <chain>` ("Default chain", default
   `ethereum`), forwarded to subcommands that take `--chain`. There is no client-side slug
   allow-list; the API validates. No code change is needed beyond `CHAIN_IDS` unless help text
   lists chains.
3. **Tests** — add a `resolveChainId("<slug>") === <id>` test (and aliases), plus a
   `test/cli-chain-option.test.ts`-style argv test proving `--chain <slug>` reaches the request.
4. **Docs** — `README.md` (global options), `docs/cli-reference.md`, `docs/examples.md`: add a
   `--chain <slug>` example.
5. **Checks**: `npm ci`, `npm run type-check`, `npm run lint`, `npm test`. The repo has no
   `.gitignore`; stage files explicitly (never `git add -A`).
6. **Demo** — run the CLI with `--chain <slug> --base-url http://127.0.0.1:<port>` against a local
   mock server (fictional data only) and record it.

## 4. PR bodies

- State the chain id, every token address with its doc link, which helpers throw (and why), and
  the Seaport/conduit/zone `eth_getCode` result.
- PRs go to the fork's `main` (`COG-GTM/...`), never `ProjectOpenSea`. Never merge.
- End every PR description with the line `Devin-Org: engineering`.
