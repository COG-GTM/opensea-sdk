import { describe, expect, test, vi } from "vitest"
import { CELO_TOKEN_ADDRESS } from "../../src/constants"
import type { SDKContext } from "../../src/sdk/context"
import { TokensManager } from "../../src/sdk/tokens"
import { Chain, EventType } from "../../src/types"
import { getOfferPaymentToken } from "../../src/utils/chain"

const ACCOUNT = "0x1111111111111111111111111111111111111111"

const createContext = (chain: Chain) => {
  const context = {
    chain,
    requireAccountIsAvailable: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn(),
    confirmTransaction: vi.fn().mockResolvedValue(undefined),
    contractCaller: {
      writeContract: vi.fn().mockResolvedValue({ hash: "0xabc" }),
    },
  }
  return context
}

const METHODS = [
  ["wrapEth", "deposit"],
  ["unwrapWeth", "withdraw"],
] as const

describe("TokensManager", () => {
  test.each(METHODS)("%s rejects on Celo without sending", async method => {
    const context = createContext(Chain.Celo)
    const tokens = new TokensManager(context as unknown as SDKContext)

    await expect(
      tokens[method]({ amountInEth: "1", accountAddress: ACCOUNT }),
    ).rejects.toThrow(CELO_TOKEN_ADDRESS)

    expect(context.contractCaller.writeContract).not.toHaveBeenCalled()
    expect(context.dispatch).not.toHaveBeenCalledWith(
      EventType.TransactionDenied,
      expect.anything(),
    )
  })

  test.each(METHODS)("%s calls %s on Sonic", async (method, functionName) => {
    const context = createContext(Chain.Sonic)
    const tokens = new TokensManager(context as unknown as SDKContext)

    await tokens[method]({ amountInEth: "1", accountAddress: ACCOUNT })

    expect(context.contractCaller.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: getOfferPaymentToken(Chain.Sonic),
        functionName,
      }),
    )
  })
})
