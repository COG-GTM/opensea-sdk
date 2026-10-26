import { describe, expect, test, vi } from "vitest"
import type { SDKContext } from "../../src/sdk/context"
import { TokensManager } from "../../src/sdk/tokens"
import { Chain, EventType } from "../../src/types"

const ACCOUNT = "0x0000000000000000000000000000000000000001"

function harness(chain: Chain) {
  const writeContract = vi.fn().mockResolvedValue({ hash: "0xwrap" })
  const dispatch = vi.fn()
  const context = {
    chain,
    contractCaller: { writeContract },
    confirmTransaction: vi.fn().mockResolvedValue(undefined),
    requireAccountIsAvailable: vi.fn().mockResolvedValue(undefined),
    dispatch,
  } as unknown as SDKContext
  return { manager: new TokensManager(context), writeContract, dispatch }
}

describe("TokensManager: chains without a wrapped native token", () => {
  for (const method of ["wrapEth", "unwrapWeth"] as const) {
    test(`${method} rejects on Celo without sending a transaction`, async () => {
      const h = harness(Chain.Celo)

      await expect(
        h.manager[method]({ amountInEth: "1", accountAddress: ACCOUNT }),
      ).rejects.toThrow("has no wrapped native token")
      expect(h.writeContract).not.toHaveBeenCalled()
      expect(h.dispatch).not.toHaveBeenCalled()
    })
  }

  test("wrapEth still wraps on a chain with a wrapper", async () => {
    const h = harness(Chain.Mainnet)

    await h.manager.wrapEth({ amountInEth: "1", accountAddress: ACCOUNT })

    expect(h.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "deposit" }),
    )
    expect(h.dispatch).toHaveBeenCalledWith(
      EventType.WrapEth,
      expect.anything(),
    )
  })
})
