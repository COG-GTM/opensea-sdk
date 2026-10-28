import { describe, expect, test, vi } from "vitest"
import { APPROVE_ABI, SET_APPROVAL_FOR_ALL_ABI } from "../../src/abi/abis"
import { MAX_UINT256, OPENSEA_CONDUIT_ADDRESS } from "../../src/constants"
import { AssetsManager } from "../../src/sdk/assets"
import type { SDKContext } from "../../src/sdk/context"
import { Chain, EventType, TokenStandard } from "../../src/types"

const TOKEN = "0x0f5d2fb29fb7d3cfee444a200298f468908cc942"
const FROM = "0x0000000000000000000000000000000000000001"

/**
 * batchApproveAssets only touches a handful of context members, so build the
 * minimum and cast. Allowance reads return 0 so every asset looks unapproved.
 */
function harness(chain: Chain = Chain.Mainnet, allowance = 0n) {
  const sendTransaction = vi.fn().mockResolvedValue({ hash: "0xtest" })
  const writeContract = vi.fn().mockResolvedValue({ hash: "0xmulticall" })
  const encodeFunctionData = vi.fn().mockReturnValue("0xapproval")
  const confirmTransaction = vi.fn().mockResolvedValue(undefined)

  const context = {
    chain,
    wallet: { signer: { sendTransaction } },
    contractCaller: {
      readContract: vi.fn().mockResolvedValue(allowance),
      writeContract,
      encodeFunctionData,
    },
    confirmTransaction,
    requireAccountIsAvailable: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn(),
    logger: vi.fn(),
  } as unknown as SDKContext

  return {
    manager: new AssetsManager(context),
    sendTransaction,
    writeContract,
    encodeFunctionData,
    confirmTransaction,
    readContract: (
      context.contractCaller as unknown as {
        readContract: ReturnType<typeof vi.fn>
      }
    ).readContract,
  }
}

const erc20 = (tokenAddress: string, amount: string) => ({
  asset: { tokenAddress, tokenId: null, tokenStandard: TokenStandard.ERC20 },
  amount,
})

describe("AssetsManager: batchApproveAssets", () => {
  test("sends one approval for the same ERC20 contract, matching case-insensitively", async () => {
    const h = harness()

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(TOKEN.toUpperCase(), "2")],
      fromAddress: FROM,
    })

    // One approval for the summed amount, so it goes direct rather than
    // through Multicall3.
    expect(h.encodeFunctionData).toHaveBeenCalledTimes(1)
    expect(h.encodeFunctionData).toHaveBeenCalledWith({
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [OPENSEA_CONDUIT_ADDRESS, 3n],
    })
    expect(h.sendTransaction).toHaveBeenCalledTimes(1)
    expect(h.writeContract).not.toHaveBeenCalled()
    expect(h.confirmTransaction).toHaveBeenCalledWith(
      "0xtest",
      EventType.ApproveAllAssets,
      "Approving asset for transfer",
    )
  })

  test("still sends one approval per distinct ERC20 contract", async () => {
    const h = harness()
    const other = "0x1111111111111111111111111111111111111111"

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(other, "2")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledTimes(2)
    expect(h.encodeFunctionData.mock.calls.map(c => c[0].args)).toEqual([
      [OPENSEA_CONDUIT_ADDRESS, 1n],
      [OPENSEA_CONDUIT_ADDRESS, 2n],
    ])
    // Two approvals batch through Multicall3 instead of going direct.
    expect(h.writeContract).toHaveBeenCalledTimes(1)
    expect(h.sendTransaction).not.toHaveBeenCalled()
  })

  test("approves the canonical conduit for the requested amount on Gnosis", async () => {
    const h = harness(Chain.Gnosis)

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1000000000000000000")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledWith({
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [OPENSEA_CONDUIT_ADDRESS, 1000000000000000000n],
    })
    const [args] = h.encodeFunctionData.mock.calls[0]
    expect(args.args[0]).toBe("0x1e0049783f008a0085193e00003d00cd54003c71")
    expect(args.args[1]).not.toBe(MAX_UINT256)
  })

  test("checks the existing allowance against the summed amount", async () => {
    // Allowance covers each entry alone but not their sum.
    const h = harness(Chain.Gnosis, 2n)

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "2"), erc20(TOKEN, "2")],
      fromAddress: FROM,
    })

    expect(h.readContract).toHaveBeenCalledTimes(1)
    expect(h.encodeFunctionData).toHaveBeenCalledWith({
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [OPENSEA_CONDUIT_ADDRESS, 4n],
    })
  })

  test("clears a leftover nonzero allowance before raising it", async () => {
    // e.g. 60 left after a partial spend; USDT-style tokens reject 60 -> 100.
    const h = harness(Chain.Gnosis, 60n)

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "100")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData.mock.calls.map(c => c[0].args)).toEqual([
      [OPENSEA_CONDUIT_ADDRESS, 0n],
      [OPENSEA_CONDUIT_ADDRESS, 100n],
    ])
    // Both come from the owner's signer, never through Multicall3, and the
    // reset is confirmed before the new approval is sent.
    expect(h.writeContract).not.toHaveBeenCalled()
    expect(h.sendTransaction.mock.calls.map(c => c[0].to)).toEqual([
      TOKEN,
      TOKEN,
    ])
    expect(h.sendTransaction.mock.calls.map(c => c[0].from)).toEqual([
      FROM,
      FROM,
    ])
    expect(h.confirmTransaction).toHaveBeenCalledTimes(2)
    expect(h.confirmTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      h.sendTransaction.mock.invocationCallOrder[1],
    )
  })

  test("sends a reset directly even when other approvals are batched", async () => {
    const other = "0x1111111111111111111111111111111111111111" // DEMO PLACEHOLDER
    const h = harness(Chain.Gnosis)
    h.readContract.mockImplementation(async ({ address }) =>
      address === TOKEN ? 60n : 0n,
    )

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "100"), erc20(other, "5")],
      fromAddress: FROM,
    })

    expect(h.sendTransaction).toHaveBeenCalledTimes(1)
    expect(h.sendTransaction.mock.calls[0][0].to).toBe(TOKEN)
    expect(h.writeContract).toHaveBeenCalledTimes(1)
    const [{ args }] = h.writeContract.mock.calls[0]
    expect(args[0].map((c: { target: string }) => c.target)).toEqual([
      TOKEN,
      other,
    ])
    expect(h.sendTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      h.writeContract.mock.invocationCallOrder[0],
    )
  })

  test("does not reset when there is no existing allowance", async () => {
    const h = harness(Chain.Gnosis, 0n)

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "100")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledTimes(1)
    expect(h.sendTransaction).toHaveBeenCalledTimes(1)
  })

  test("skips the approval when the allowance already covers the sum", async () => {
    const h = harness(Chain.Gnosis, 4n)

    const result = await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "2"), erc20(TOKEN, "2")],
      fromAddress: FROM,
    })

    expect(result).toBeUndefined()
    expect(h.encodeFunctionData).not.toHaveBeenCalled()
  })

  test("keeps setApprovalForAll for NFTs", async () => {
    const h = harness(Chain.Gnosis, false as unknown as bigint)

    await h.manager.batchApproveAssets({
      assets: [
        {
          asset: {
            tokenAddress: "0x2222222222222222222222222222222222222222",
            tokenId: "1",
            tokenStandard: TokenStandard.ERC721,
          },
        },
      ],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledWith({
      abi: SET_APPROVAL_FOR_ALL_ABI,
      functionName: "setApprovalForAll",
      args: [OPENSEA_CONDUIT_ADDRESS, true],
    })
  })
})
