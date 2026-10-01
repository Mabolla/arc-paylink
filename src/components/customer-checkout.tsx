"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
} from "viem";
import {
  ARC_EXPLORER_URL,
  ARC_NETWORK_NAME,
  ARC_USDC_ADDRESS,
  IS_ARC_MAINNET,
} from "@/lib/arc";
import { COMMERCE_RPC_URL, commerceChain } from "@/lib/commerce/network";
import { parseUsdcAmount } from "@/lib/amount";
import { demoOrders, demoPay } from "@/lib/commerce/demo-client";
import type { PublicOrder } from "@/lib/commerce/types";
import styles from "./business.module.css";
import { ExternalCheckout } from "./external-checkout";

export const CHECKOUT_RETURN = "arcpaylink.checkout.return";
type Login = { userToken: string; encryptionKey: string };
type Wallet = { id: string; address: string; blockchain: string };
const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const deviceKey = "arc-paylink.circle.device-token";
const encryptionKey = "arc-paylink.circle.device-encryption-key";
const client = createPublicClient({ chain: commerceChain, transport: http(COMMERCE_RPC_URL) });
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error ?? value.message ?? "The request could not be completed.",
    );
  return value;
}
const messageOf = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String(e.message)
    : "Unable to complete this step. Check payment status before trying again.";

export function CustomerCheckout({
  orderId,
  demo = false,
}: {
  orderId: string;
  demo?: boolean;
}) {
  const [order, setOrder] = useState<PublicOrder>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState(
    "Sign in to pay without a wallet extension.",
  );
  const [stage, setStage] = useState("loading");
  const [wallet, setWallet] = useState<Wallet>();
  const [balance, setBalance] = useState<bigint>();
  const [ready, setReady] = useState(false);
  const sdkRef = useRef<W3SSdk | null>(null);
  const loginRef = useRef<Login | null>(null);
  const challengeRef = useRef<string | undefined>(undefined);
  const guard = useRef(false);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    if (demo) {
      const found = demoOrders().find((o) => o.id === orderId);
      if (!found)
        throw new Error(
          "Sandbox order not found. Open it from the business sandbox.",
        );
      setOrder(found);
      setReady(true);
      return found;
    }
    const result = await api<{
      order: PublicOrder;
      embeddedWalletReady: boolean;
    }>(`/api/checkout/${orderId}`);
    setOrder(result.order);
    setReady(result.embeddedWalletReady);
    return result.order;
  }, [demo, orderId]);
  const loadWallet = useCallback(
    async (login: Login) => {
      const result = await api<{ wallets?: Wallet[] }>("/api/circle", {
        action: "listWallets",
        userToken: login.userToken,
      });
      const found = result.wallets?.find(
        (w) => w.blockchain === (IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET"),
      );
      if (found) {
        setWallet(found);
        setStage("review");
        setMessage("Your account is ready. Review the purchase before paying.");
        const value = await client.readContract({
          address: ARC_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [getAddress(found.address)],
        });
        setBalance(value);
        return;
      }
      const scope = `arcpaylink.checkout.wallet-init.${orderId}`;
      const idempotencyKey =
        sessionStorage.getItem(scope) || crypto.randomUUID();
      sessionStorage.setItem(scope, idempotencyKey);
      const init = await api<{ challengeId: string }>("/api/circle", {
        action: "initializeUser",
        userToken: login.userToken,
        idempotencyKey,
      });
      if (!init.challengeId)
        throw new Error("Account setup did not return an approval.");
      challengeRef.current = init.challengeId;
      setStage("create-wallet");
      setMessage(
        "Create your secure payment account with Circle. No browser extension is needed.",
      );
    },
    [orderId],
  );
  useEffect(() => {
    active.current = true;
    queueMicrotask(() => {
      void refresh()
        .then(() => setStage((s) => (s === "loading" ? "signin" : s)))
        .catch((e) => {
          setError(messageOf(e));
          setStage("unavailable");
        });
    });
    if (!demo && appId && googleClientId)
      void (async () => {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
        const sdk = new W3SSdk(
          {
            appSettings: { appId },
            loginConfigs: {
              deviceToken: sessionStorage.getItem(deviceKey) ?? "",
              deviceEncryptionKey: sessionStorage.getItem(encryptionKey) ?? "",
              google: {
                clientId: googleClientId,
                redirectUri: `${window.location.origin}/wallet`,
                selectAccountPrompt: true,
              },
            },
          },
          (e: unknown, result) => {
            if (!active.current) return;
            if (e || !result?.userToken || !result.encryptionKey) {
              setError(messageOf(e));
              setStage("signin");
              return;
            }
            const login = {
              userToken: result.userToken,
              encryptionKey: result.encryptionKey,
            };
            loginRef.current = login;
            setStage("working");
            setMessage("Loading your payment account…");
            void loadWallet(login).catch((reason) => {
              setError(messageOf(reason));
              setStage("signin");
            });
          },
        );
        sdkRef.current = sdk;
      })().catch((e) => {
        setError(messageOf(e));
      });
    const interval = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 10000);
    return () => {
      active.current = false;
      clearInterval(interval);
    };
  }, [demo, refresh, loadWallet]);
  async function signIn() {
    const sdk = sdkRef.current;
    if (!sdk) {
      setError("Secure sign-in is still loading or unavailable.");
      return;
    }
    setError("");
    setStage("working");
    setMessage("Opening Google sign-in…");
    try {
      sessionStorage.setItem(
        CHECKOUT_RETURN,
        JSON.stringify({ orderId, startedAt: Date.now() }),
      );
      const tokens = await api<{
        deviceToken: string;
        deviceEncryptionKey: string;
      }>("/api/circle", {
        action: "createDeviceToken",
        deviceId: await sdk.getDeviceId(),
      });
      sessionStorage.setItem(deviceKey, tokens.deviceToken);
      sessionStorage.setItem(encryptionKey, tokens.deviceEncryptionKey);
      sdk.updateConfigs({
        appSettings: { appId },
        loginConfigs: {
          ...tokens,
          google: {
            clientId: googleClientId,
            redirectUri: `${window.location.origin}/wallet`,
            selectAccountPrompt: true,
          },
        },
      });
      sdk.performLogin(SocialLoginProvider.GOOGLE);
    } catch (e) {
      setError(messageOf(e));
      setStage("signin");
    }
  }
  function createWallet() {
    const sdk = sdkRef.current;
    const login = loginRef.current;
    const challenge = challengeRef.current;
    if (!sdk || !login || !challenge || guard.current) return;
    guard.current = true;
    setStage("working");
    sdk.setAuthentication(login);
    sdk.execute(challenge, (e) => {
      guard.current = false;
      if (e) {
        setError(messageOf(e));
        setStage("create-wallet");
        return;
      }
      void loadWallet(login).catch((reason) => {
        setError(messageOf(reason));
        setStage("signin");
      });
    });
  }
  async function reconcile() {
    const login = loginRef.current;
    if (!login || !wallet) return;
    setStage("checking");
    setError("");
    setMessage(
      "Checking the saved payment. This does not send another transfer.",
    );
    try {
      for (let i = 0; i < 12 && active.current; i++) {
        const result = await api<{ order: PublicOrder }>(
          `/api/checkout/${orderId}`,
          {
            action: "reconcile",
            userToken: login.userToken,
            walletId: wallet.id,
          },
        );
        setOrder(result.order);
        if (result.order.status === "paid") {
          sessionStorage.removeItem(CHECKOUT_RETURN);
          setStage("complete");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      setMessage(
        "Payment is still processing. Check again to recover its receipt without paying twice.",
      );
      setStage("resume");
    } catch (e) {
      setError(messageOf(e));
      setStage("resume");
    }
  }
  async function prepare() {
    const login = loginRef.current;
    if (!login || !wallet || guard.current) return;
    guard.current = true;
    setError("");
    setStage("working");
    setMessage("Preparing the exact purchase for your approval…");
    try {
      const result = await api<{ order: PublicOrder; challengeId?: string }>(
        `/api/checkout/${orderId}`,
        { action: "prepare", userToken: login.userToken, walletId: wallet.id },
      );
      setOrder(result.order);
      if (result.order.status === "paid") {
        setStage("complete");
        return;
      }
      if (!result.challengeId)
        throw new Error(
          "Payment approval is unavailable. Check status before retrying.",
        );
      challengeRef.current = result.challengeId;
      setStage("approve");
      setMessage(
        "Confirm the amount and recipient, then approve securely with Circle.",
      );
    } catch (e) {
      setError(messageOf(e));
      setStage("resume");
    } finally {
      guard.current = false;
    }
  }
  function approve() {
    const sdk = sdkRef.current;
    const login = loginRef.current;
    const challenge = challengeRef.current;
    if (!sdk || !login || !challenge || guard.current) return;
    guard.current = true;
    setStage("working");
    setError("");
    setMessage("Complete the approval in Circle's secure window.");
    sdk.setAuthentication(login);
    sdk.execute(challenge, (e) => {
      guard.current = false;
      if (e) {
        setError(messageOf(e));
        setStage("resume");
        return;
      }
      void reconcile();
    });
  }
  const busy = ["loading", "working", "checking"].includes(stage);
  const insufficient =
    !!order && balance !== undefined && balance < parseUsdcAmount(order.amount);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <b>A</b>Arc PayLink
        </Link>
        <span className={styles.badge}>
          {demo ? "SANDBOX CHECKOUT" : ARC_NETWORK_NAME}
        </span>
      </header>
      {demo && (
        <div className={styles.demo}>
          <strong>Simulated customer checkout.</strong> This page updates only
          sandbox data in your browser. It does not sign in to Google or send
          funds.
        </div>
      )}
      <div className={styles.checkout}>
        <section>
          <p className={styles.eyebrow}>
            {order?.merchantName ?? "Customer payment"}
          </p>
          <h1>{order?.title ?? "Loading payment…"}</h1>
          {order && (
            <>
              <p className={styles.amount}>
                {order.amount}
                <small>USDC</small>
              </p>
              <p className={styles.muted}>{order.reference}</p>
              <dl>
                <div className={styles.detail}>
                  <dt>Business</dt>
                  <dd>{order.merchantName}</dd>
                </div>
                <div className={styles.detail}>
                  <dt>Status</dt>
                  <dd>
                    <span className={styles.status} data-status={order.status}>
                      {order.status}
                    </span>
                  </dd>
                </div>
                <div className={styles.detail}>
                  <dt>Receiving address</dt>
                  <dd>{order.recipient}</dd>
                </div>
                {order.dueAt && (
                  <div className={styles.detail}>
                    <dt>Due</dt>
                    <dd>{new Date(order.dueAt).toLocaleDateString()}</dd>
                  </div>
                )}
              </dl>
              <p className={styles.note}>
                Check the business, purchase and receiving address before
                approving. Arc PayLink records the payment; the business
                supplies the purchase.
              </p>
            </>
          )}
        </section>
        <section className={styles.card}>
          {order?.status === "paid" ? (
            <>
              <p className={styles.eyebrow}>Payment complete</p>
              <h2>
                {demo ? "Sandbox purchase recorded." : "Your purchase is paid."}
              </h2>
              <p className={styles.muted}>
                {demo
                  ? "Return to the dashboard to see the updated order and agent report."
                  : "The USDC transfer was verified on Arc and recorded for the business."}
              </p>
              <div className={styles.success}>
                {order.amount} USDC · {order.reference}
              </div>
              {order.receipt && (
                <>
                  <p className={styles.muted}>Receipt</p>
                  <pre className={styles.code}>
                    {JSON.stringify(
                      {
                        reference: order.reference,
                        amount: order.amount,
                        ...order.receipt,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  {!demo && (
                    <a
                      className={styles.secondary}
                      href={`${ARC_EXPLORER_URL}/tx/${order.receipt.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View onchain receipt ↗
                    </a>
                  )}
                </>
              )}
              {demo && (
                <Link className={styles.button} href="/business/demo">
                  Back to business dashboard →
                </Link>
              )}
            </>
          ) : order?.status === "cancelled" ? (
            <>
              <h2>This link is cancelled.</h2>
              <p className={styles.muted}>
                Ask the business for an updated payment link.
              </p>
            </>
          ) : (
            <>
              <p className={styles.eyebrow}>Simple, secure checkout</p>
              <h2>Pay without a wallet extension.</h2>
              <p className={styles.muted}>
                Sign in with Google, use your embedded USDC account and approve
                this purchase.
              </p>
              <div className={styles.steps}>
                <div className={styles.step}>
                  <i>1</i>
                  <span>Sign in or create your payment account.</span>
                </div>
                <div className={styles.step}>
                  <i>2</i>
                  <span>
                    Review {order?.amount ?? "the amount"} USDC and approve with
                    Circle.
                  </span>
                </div>
                <div className={styles.step}>
                  <i>3</i>
                  <span>Get a receipt after Arc confirms the transfer.</span>
                </div>
              </div>
              {error && (
                <div className={styles.alert} role="alert">
                  {error}
                </div>
              )}
              <p className={styles.note} role="status">
                {busy ? "Working… " : ""}
                {message}
              </p>
              {demo ? (
                <button
                  className={styles.button}
                  disabled={!order}
                  onClick={() => {
                    const result = demoPay(orderId);
                    if (result) setOrder({ ...result });
                  }}
                >
                  Simulate approved purchase →
                </button>
              ) : !ready && stage !== "loading" ? (
                <div className={styles.alert}>
                  Secure checkout is not activated on this deployment. No
                  payment has been started.
                </div>
              ) : (
                <>
                  {stage === "signin" && (
                    <button
                      className={styles.button}
                      onClick={() => void signIn()}
                    >
                      Continue with Google →
                    </button>
                  )}
                  {stage === "create-wallet" && (
                    <button className={styles.button} onClick={createWallet}>
                      Create payment account →
                    </button>
                  )}
                  {wallet && (
                    <>
                      <dl>
                        <div className={styles.detail}>
                          <dt>Available balance</dt>
                          <dd>
                            {balance === undefined
                              ? "Checking…"
                              : `${formatUnits(balance, 6)} USDC`}
                          </dd>
                        </div>
                      </dl>
                      {insufficient && (
                        <div className={styles.note}>
                          <strong>Add USDC to continue.</strong>
                          <p>
                            Your account needs {order?.amount} USDC on{" "}
                            {ARC_NETWORK_NAME}. Card payments are not available
                            in this checkout.
                          </p>
                          <pre className={styles.code}>{wallet.address}</pre>
                          <button
                            className={styles.secondary}
                            onClick={() => {
                              if (loginRef.current)
                                void loadWallet(loginRef.current).catch((e) =>
                                  setError(messageOf(e)),
                                );
                            }}
                          >
                            Refresh balance
                          </button>
                        </div>
                      )}
                      {["review", "resume"].includes(stage) && (
                        <div className={styles.stack}>
                          <button
                            className={styles.button}
                            disabled={
                              busy || insufficient || balance === undefined
                            }
                            onClick={() => void prepare()}
                          >
                            {order?.status === "processing"
                              ? "Resume saved payment"
                              : `Review ${order?.amount} USDC payment`}{" "}
                            →
                          </button>
                          {order?.status === "processing" && (
                            <button
                              className={styles.secondary}
                              disabled={busy}
                              onClick={() => void reconcile()}
                            >
                              Check payment status
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {stage === "approve" && (
                    <div className={styles.stack}>
                      <p className={styles.note}>
                        {order?.amount} USDC → {order?.recipient}
                      </p>
                      <button className={styles.button} onClick={approve}>
                        Approve {order?.amount} USDC →
                      </button>
                      <button
                        className={styles.secondary}
                        onClick={() => void reconcile()}
                      >
                        Check existing payment
                      </button>
                    </div>
                  )}
                </>
              )}
              <div className={styles.divider} />
              {!demo && order && <ExternalCheckout order={order} onPaid={setOrder} />}
              <p className={styles.muted}>
                Your account remains under your control. Arc PayLink does not
                receive your private keys. A USDC balance is required.
              </p>
            </>
          )}
        </section>
      </div>
      <footer className={styles.footer}>
        <span>Arc PayLink · Customer checkout</span>
        <span>
          {demo
            ? "No real funds · Local sandbox"
            : "Verified USDC payments on Arc"}
        </span>
      </footer>
    </div>
  );
}
