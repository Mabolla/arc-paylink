const { setTimeout: delay } = require("node:timers/promises");
const { TransactionReceiptNotFoundError } = require("viem");

// Arc's public RPC occasionally returns null for an already confirmed historical
// receipt. Retry that specific response, then still fail if no receipt is found.
// Verification of the returned receipt remains the caller's responsibility.
async function readDeploymentReceipt(client, hash, options = {}) {
  const wait = options.wait || delay;
  const onRetry = options.onRetry || (() => {});
  const retryDelays = [1000, 2000, 4000];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError) || attempt >= retryDelays.length) {
        throw error;
      }
      onRetry({ attempt: attempt + 2, delayMs: retryDelays[attempt] });
      await wait(retryDelays[attempt]);
    }
  }
}

module.exports = { readDeploymentReceipt };
