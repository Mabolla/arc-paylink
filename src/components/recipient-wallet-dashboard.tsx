"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseUnits, type Hash } from "viem";
import { ARC_EXPLORER_URL, ARC_NETWORK_NAME, ARC_RPC_URL, ARC_USDC_ADDRESS, IS_ARC_MAINNET, arcChain } from "@/lib/arc";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const circleBlockchain = IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET";
const client = createPublicClient({ chain: arcChain, transport: http(ARC_RPC_URL) });
const SESSION_KEYS = { deviceToken: "arc-paylink.circle.device-token", deviceEncryptionKey: "arc-paylink.circle.device-encryption-key" } as const;

type Login = { userToken: string; encryptionKey: string };
type Wallet = { id: string; address: string; blockchain: string };
type Status = "loading" | "ready" | "authenticating" | "loading-wallet" | "active" | "preparing" | "approval" | "submitting" | "confirming" | "sent" | "failed";

function messageOf(value: unknown) {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return "Circle wallet request failed.";
}

async function circleAction<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/circle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(messageOf(payload));
  return payload as T;
}

export function RecipientWalletDashboard() {
  const sdkRef = useRef<W3SSdk | null>(null);
  const loginRef = useRef<Login | null>(null);
  const challengeRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Preparing secure Google sign-in.");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState<Hash | null>(null);

  const refreshBalance = useCallback(async (address: string) => {
    const value = await client.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });
    setBalance(value);
  }, []);

  const loadWallet = useCallback(async (userToken: string) => {
    const result = await circleAction<{ wallets?: Wallet[] }>({ action: "listWallets", userToken });
    const found = result.wallets?.find((item) => item.blockchain === circleBlockchain);
    if (!found) throw new Error(`No ${ARC_NETWORK_NAME} wallet exists for this Google account.`);
    setWallet(found);
    await refreshBalance(found.address);
    setStatus("active");
    setMessage("Wallet connected. Your balance is read directly from Arc.");
  }, [refreshBalance]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        if (!appId || !googleClientId) throw new Error("Circle wallet configuration is incomplete.");
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
        const redirectUri = `${window.location.origin}/wallet`;
        const sdk = new W3SSdk({
          appSettings: { appId },
          loginConfigs: {
            deviceToken: sessionStorage.getItem(SESSION_KEYS.deviceToken) ?? "",
            deviceEncryptionKey: sessionStorage.getItem(SESSION_KEYS.deviceEncryptionKey) ?? "",
            google: { clientId: googleClientId, redirectUri, selectAccountPrompt: true },
          },
        }, (error: unknown, result) => {
          if (!active) return;
          if (error || !result?.userToken || !result.encryptionKey) {
            setStatus("failed"); setMessage(error ? messageOf(error) : "Circle login did not return a wallet session."); return;
          }
          loginRef.current = { userToken: result.userToken, encryptionKey: result.encryptionKey };
          setStatus("loading-wallet"); setMessage("Google verified. Loading your Arc wallet.");
          void loadWallet(result.userToken).catch((loadError) => { setStatus("failed"); setMessage(messageOf(loadError)); });
        });
        sdkRef.current = sdk;
        if (active) { setStatus("ready"); setMessage("Sign in with the same Google account used to claim your PayLink."); }
      } catch (error) { if (active) { setStatus("failed"); setMessage(messageOf(error)); } }
    }
    void initialize();
    return () => { active = false; };
  }, [loadWallet]);

  async function signIn() {
    const sdk = sdkRef.current;
    if (!sdk) return;
    try {
      setStatus("authenticating"); setMessage("Opening Google sign-in.");
      const tokens = await circleAction<{ deviceToken: string; deviceEncryptionKey: string }>({ action: "createDeviceToken", deviceId: await sdk.getDeviceId() });
      sessionStorage.setItem(SESSION_KEYS.deviceToken, tokens.deviceToken);
      sessionStorage.setItem(SESSION_KEYS.deviceEncryptionKey, tokens.deviceEncryptionKey);
      sdk.updateConfigs({ appSettings: { appId }, loginConfigs: { deviceToken: tokens.deviceToken, deviceEncryptionKey: tokens.deviceEncryptionKey, google: { clientId: googleClientId, redirectUri: `${window.location.origin}/wallet`, selectAccountPrompt: true } } });
      sdk.performLogin(SocialLoginProvider.GOOGLE);
    } catch (error) { setStatus("failed"); setMessage(messageOf(error)); }
  }

  async function prepareTransfer(event: React.FormEvent) {
    event.preventDefault();
    const login = loginRef.current;
    if (!login || !wallet) return;
    try {
      if (!isAddress(recipient)) throw new Error("Enter a valid Arc destination address.");
      const units = parseUnits(amount, 6);
      if (units <= 0n) throw new Error("Amount must be greater than zero.");
      if (units > balance) throw new Error("Amount exceeds this wallet's USDC balance.");
      setStatus("preparing"); setMessage("Preparing the exact USDC transfer.");
      const result = await circleAction<{ challengeId?: string }>({
        action: "transferUsdc", userToken: login.userToken, walletId: wallet.id, walletAddress: wallet.address,
        recipient: getAddress(recipient), amountBaseUnits: units.toString(), idempotencyKey: crypto.randomUUID(),
      });
      if (!result.challengeId) throw new Error("Circle did not return a transfer challenge.");
      challengeRef.current = result.challengeId;
      setStatus("approval"); setMessage(`Review and approve sending ${formatUnits(units, 6)} USDC in Circle.`);
    } catch (error) { setStatus("failed"); setMessage(messageOf(error)); }
  }

  function approveTransfer() {
    const sdk = sdkRef.current; const login = loginRef.current; const challengeId = challengeRef.current;
    if (!sdk || !login || !challengeId || !wallet) return;
    setStatus("submitting"); setMessage("Approve the transfer in Circle's secure confirmation window.");
    sdk.setAuthentication(login);
    sdk.execute(challengeId, async (error: unknown, result) => {
      if (error) { setStatus("failed"); setMessage(messageOf(error)); return; }
      const hash = result && "data" in result && result.data && "txHash" in result.data ? result.data.txHash as Hash | undefined : undefined;
      challengeRef.current = null;
      if (!hash) { setStatus("active"); setMessage("Transfer submitted. Refresh the balance after Arc confirms it."); return; }
      setTxHash(hash); setStatus("confirming"); setMessage("Transfer submitted. Waiting for Arc confirmation.");
      try {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") throw new Error("The Arc transfer reverted.");
        await refreshBalance(wallet.address);
        setAmount(""); setRecipient(""); setStatus("sent"); setMessage("USDC sent and confirmed on Arc.");
      } catch (confirmationError) { setStatus("failed"); setMessage(messageOf(confirmationError)); }
    });
  }

  const busy = ["loading", "authenticating", "loading-wallet", "preparing", "submitting", "confirming"].includes(status);
  return <section className="wallet-panel" aria-labelledby="wallet-dashboard-heading">
    <div className="panel-heading"><div><p className="eyebrow">Recipient wallet</p><h2 id="wallet-dashboard-heading">Your Arc wallet</h2></div><span className="step">Circle · Google</span></div>
    <p className="wallet-copy">Access the wallet created during your claim. Arc PayLink never receives its private keys.</p>
    <div className={`status-box ${status === "failed" ? "failed" : status === "sent" ? "paid" : busy ? "pending" : ""}`} role="status">{message}{busy && <span className="spinner" />}</div>
    {status === "ready" && <button className="primary-button full" onClick={() => void signIn()}>Continue with Google <span>→</span></button>}
    {wallet && <>
      <dl className="payment-details wallet-details">
        <div><dt>Network</dt><dd>{ARC_NETWORK_NAME}</dd></div>
        <div><dt>Wallet</dt><dd className="mono wallet-address">{wallet.address}</dd></div>
        <div><dt>Available balance</dt><dd><strong>{formatUnits(balance, 6)} USDC</strong></dd></div>
      </dl>
      {status !== "approval" && status !== "submitting" && <form className="request-form" onSubmit={(event) => void prepareTransfer(event)}>
        <label>Destination Arc address<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x..." required /></label>
        <label>USDC amount<div className="amount-input"><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" required /><b>USDC</b></div></label>
        <button className="primary-button full" disabled={busy || balance === 0n}>Review transfer <span>→</span></button>
      </form>}
      {status === "approval" && <button className="primary-button full" onClick={approveTransfer}>Approve USDC transfer <span>→</span></button>}
      {txHash && <a className="explorer-link mono" href={`${ARC_EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction on ArcScan ↗</a>}
      <button className="text-button" disabled={busy} onClick={() => void refreshBalance(wallet.address).catch((error) => { setStatus("failed"); setMessage(messageOf(error)); })}>Refresh balance</button>
    </>}
    <p className="security-note">Only approve the destination and amount you intend to send. Transfers confirmed on Arc cannot be reversed.</p>
  </section>;
}
