// Minimal projection of the Chainflip explorer's `GetSwapByNativeId` operation — only the fields the
// verifier consumes. `swapRequestByNativeId` is keyed by the swap-request nativeId we store as
// `metadata.chainflipSwapId`. Affiliate attribution + realized commission live under `beneficiaries`;
// commission is summed per-asset via `groupedAggregates(groupBy: ASSET)` so DCA chunks aggregate into
// one group. `executedSwaps` sums the actually-swapped input (excludes any refunded portion).
export const GET_SWAP_BY_NATIVE_ID_OPERATION = 'GetSwapByNativeId'

export const GET_SWAP_BY_NATIVE_ID_QUERY = `query GetSwapByNativeId($nativeId: BigInt!) {
  swapRequest: swapRequestByNativeId(nativeId: $nativeId) {
    executedSwaps: swapsBySwapRequestId(
      filter: { swapExecutedEventId: { isNull: false }, type: { notEqualTo: GAS } }
    ) {
      aggregates {
        sum {
          swapInputAmount
        }
      }
    }
    egress: egressByEgressId {
      amount
    }
    beneficiaries: swapRequestBeneficiariesBySwapRequestId(orderBy: TYPE_ASC) {
      nodes {
        type
        brokerCommissionRateBps
        commissions: swapCommissionsBySwapRequestBeneficiaryId {
          groupedAggregates(groupBy: ASSET) {
            asset: keys
            sum {
              amount
              valueUsd
            }
          }
        }
        account: accountByAccountId {
          idSs58
        }
      }
    }
  }
}`
