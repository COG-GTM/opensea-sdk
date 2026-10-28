---
title: Frequently Asked Questions
category: 64cbb5277b5f3c0065d96616
slug: opensea-sdk-faq
parentDocSlug: opensea-sdk
order: 4
hidden: false
---

- [How do I access the source code?](#how-do-i-access-the-source-code)
- [What chains are supported?](#what-chains-are-supported)
- [Why is there no SDK method for the API request I am trying to call?](#why-is-there-no-sdk-method-for-the-api-request-i-am-trying-to-call)
- [Does the SDK support viem?](#does-the-sdk-support-viem)
- [What changed in v10?](#what-changed-in-v10)

## How do I access the source code?

The source code for the SDK can be found on [GitHub](https://github.com/ProjectOpenSea/opensea-sdk).

## What chains are supported?

See the `Chain` enum in [`src/types.ts`](https://github.com/ProjectOpenSea/opensea-sdk/blob/main/src/types.ts) for a complete list of supported chains.

EVM chains such as Scroll (`Chain.Scroll`, chain id `534352`) are listed there with their default payment tokens in [`src/utils/chain.ts`](https://github.com/ProjectOpenSea/opensea-sdk/blob/main/src/utils/chain.ts).

For example, Taiko is `Chain.Taiko` (`"taiko"`, chain id `167000`): listings are priced in native ETH and offers use Taiko WETH `0xA51894664A773981C6C112C43ce576f315d5b1B6` ([Taiko contract addresses](https://docs.taiko.xyz/network/contract-addresses)). The OpenSea conduit and signed zone are not yet deployed on Taiko, so orders cannot settle there until OpenSea deploys them.

For example, Mode is `Chain.Mode` (chain id `34443`): listings are priced in native ETH and offers in WETH (`0x4200000000000000000000000000000000000006`). OpenSea's Seaport 1.6, conduit and signed zone are not deployed on Mode yet, so its orders cannot settle on-chain until they are.

Each value is the OpenSea API chain identifier, e.g. `Chain.Mainnet` (`"ethereum"`), `Chain.Base` (`"base"`) or `Chain.Gnosis` (`"gnosis"`, chain id 100, native xDAI listings and WXDAI offers).

For example, `Chain.Moonbeam` (`"moonbeam"`, chain ID 1284) uses native GLMR for listings and WGLMR (`0xAcc15dC74880C9944775448304B263D191c6077F`) for offers. `getChainId(Chain.Moonbeam)` returns `"1284"`. Seaport 1.6, the OpenSea conduit and the signed zone are not yet deployed on Moonbeam, so its orders cannot settle on-chain until they are.

Each EVM chain maps to its numeric chain id through `getChainId()` (for example `Chain.Lisk` is `1135`, `Chain.Base` is `8453`); it throws for non-EVM chains such as `Chain.Solana`.

For example, World Chain (chain ID 480) is `Chain.WorldChain` (`"world_chain"`). It lists in native ETH and makes offers in WETH (`0x4200000000000000000000000000000000000006`); `getChainId(Chain.WorldChain)` returns `"480"`.

For example, `Chain.Kaia` (`"kaia"`, chain id `8217`) lists in native KAIA and makes offers in WKLAY (`0x19aac5f612f524b754ca7e7c41cbfa2e981a4432`), using the standard OpenSea Seaport 1.6 and conduit.

For example, BOB is `Chain.Bob` (`"bob"`, chain id `60808`): listings are priced in native ETH and offers use WETH at `0x4200000000000000000000000000000000000006`.

For example, Cronos is `Chain.Cronos` (`"cronos"`, chain id 25): listings default to native CRO and offers to WCRO (`0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23`). Seaport 1.6, the OpenSea conduit and the signed zone are not deployed on Cronos yet, so Cronos orders cannot settle on-chain until they are.

Please use methods in the v2 API for multichain capabilities.

## Why is there no SDK method for the API request I am trying to call?

First, check the [API Reference](api-reference.md) to see all available SDK methods - many OpenSea API v2 endpoints are now supported.

If the SDK does not currently have a specific API, you can use the generic `get` and `post` methods on the `OpenSeaAPI` class in [`src/api/api.ts`](https://github.com/ProjectOpenSea/opensea-sdk/blob/main/src/api/api.ts) to make any API request. This repository is also open source, so please feel free to create a pull request.

## Does the SDK support viem?

Yes. Starting in v10, the SDK ships a dedicated `@opensea/sdk/viem` entry point. Import from that path and pass `{ publicClient }` (read-only) or `{ publicClient, walletClient }` (read + write) instead of an ethers provider/signer. See the [Quick Start Guide](quick-start.md) for full examples.

**Note on bundle size:** Even when using the viem entry point, ethers will appear in your `node_modules` as a transitive dependency of `@opensea/seaport-js`. Your application code never imports ethers directly, but the SDK uses it internally for Seaport protocol interactions. This is a known tradeoff until seaport-js adds native viem support.

## What changed in v10?

Key changes in v10:

- **Viem support** -- new `@opensea/sdk/viem` entry point that accepts `{ publicClient, walletClient }` instead of ethers `Signer | JsonRpcProvider`.
- **`OrderSide` values** -- changed from `"ask"`/`"bid"` to `"listing"`/`"offer"`.
- **`BigNumberish` replaced with `Amount`** -- the `Amount` type is `string | number | bigint`.
- **`Overrides` replaced with `Record<string, unknown>`**.
- **TypeChain removed** -- contract ABIs are used directly; no generated TypeChain wrappers.
- **`ethers.FetchRequest` replaced with native `fetch()`** for HTTP calls.
- **New provider abstraction types** -- `OpenSeaSigner`, `OpenSeaProvider`, `ContractCaller`, `OpenSeaWallet` are exported for custom provider integrations.
- **`provider` public property removed** -- The `sdk.provider` property (ethers `JsonRpcProvider`) is no longer exposed. If you need direct RPC access, use the provider you passed to the constructor. The SDK's `api` property (`sdk.api`) is still available for API queries.
- **`estimateGas` utility removed** -- This was an ethers-specific utility. Use your provider's native gas estimation instead.
