"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Hash,
} from "viem";
import {
  parsePrivateClaimPackage,
  publicClaimContext,
  type PrivateClaimPackage,
} from "@/lib/claim-package";
import { parseClaimFragment } from "@/lib/claim-link";
import { clearClientIdempotencyKey, clientIdempotencyKey } from "@/lib/client-idempotency";
import {
  ARC_EXPLORER_URL,
  ARC_NETWORK_NAME,
  ARC_RPC_URL,
  IS_ARC_MAINNET,
  arcChain,
} from "@/lib/arc";
import {
  loadConfirmedClaimReceipt,
  parseConfirmedClaimReceipt,
  removeConfirmedClaimReceipt,
  saveConfirmedClaimReceipt,
  type ConfirmedClaimReceipt,
} from "@/lib/claim-receipt-store";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const circleArcBlockchain = IS_ARC_MAINNET ? "ARC" : "ARC-TESTNET";

type LoginResult = { userToken: string; encryptionKey: string };
type SocialLoginResult = LoginResult & { oAuthInfo?: { socialUserInfo?: { email?: string } } };
type CircleWallet = { id: string; address: string; blockchain: string };
type Step = "loading" | "ready" | "authenticating" | "initializing" | "challenge-ready" | "creating" | "complete" | "failed";
type ClaimStep = "package-needed" | "ready" | "deployment-needed" | "preparing-deployment" | "deployment-ready" | "deploying" | "preparing-signature" | "signature-ready" | "signing" | "signed" | "preparing-claim" | "claim-ready" | "claiming" | "confirming" | "claimed" | "failed";

const escrowAbi = parseAbi([
  "function state() view returns (uint8)",
  "function amount() view returns (uint256)",
  "event Claimed(address indexed recipient, uint256 amount)",
]);
const confirmationClient = createPublicClient({ chain: arcChain, transport: http(ARC_RPC_URL) });
const CONFIRMATION_TIMEOUT_MS = 120_000;
const CONFIRMATION_INTERVAL_MS = 2_000;
const RECEIPT_NETWORK = IS_ARC_MAINNET ? "mainnet" : "testnet";
const CLAIM_CONTEXT_KEY = `arc-paylink.${IS_ARC_MAINNET ? "mainnet" : "testnet"}.active-claim`;

function operationScope(action: "deploy" | "claim", paymentId: string) {
  return `${IS_ARC_MAINNET ? "mainnet" : "testnet"}.${action}.${paymentId.toLowerCase()}`;
}

const SESSION_KEYS = {
  deviceToken: "arc-paylink.circle.device-token",
  deviceEncryptionKey: "arc-paylink.circle.device-encryption-key",
} as const;

function errorMessage(value: unknown) {
  if (value && typeof value === "object") {
    const candidate = value as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error === "string") return candidate.error;
  }
  return "Circle wallet onboarding failed.";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function receiptFromUrl() {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get("receipt");
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return parseConfirmedClaimReceipt(atob(padded));
  } catch {
    return null;
  } finally {
    window.history.replaceState({}, "", url.pathname);
  }
}

async function circleAction<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/circle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(errorMessage(payload)), payload);
  return payload as T;
}

export function RecipientWallet() {
  const sdkRef = useRef<W3SSdk | null>(null);
  const loginRef = useRef<LoginResult | null>(null);
  const challengeRef = useRef<string | null>(null);
  const claimChallengeRef = useRef<string | null>(null);
  const claimPackageRef = useRef<PrivateClaimPackage | null>(null);
  const claimSignatureRef = useRef<string | null>(null);
  const claimDeadlineRef = useRef<number | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [message, setMessage] = useState("Preparing secure Google sign-in.");
  const [wallet, setWallet] = useState<CircleWallet | null>(null);
  const [claimStep, setClaimStep] = useState<ClaimStep>("package-needed");
  const [claimMessage, setClaimMessage] = useState("Load the private PayLink package to unlock this claim.");
  const [claimTxHash, setClaimTxHash] = useState("");
  const [claimPackage, setClaimPackage] = useState<PrivateClaimPackage | null>(null);
  const [storedReceipt, setStoredReceipt] = useState<ConfirmedClaimReceipt | null>(null);
  const [restoringReceipt, setRestoringReceipt] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const linked = parseClaimFragment(window.location.hash);
        if (linked) {
          sessionStorage.setItem(CLAIM_CONTEXT_KEY, JSON.stringify(linked));
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
        }
        const raw = linked ? null : sessionStorage.getItem(CLAIM_CONTEXT_KEY);
        const restored = linked ?? (raw ? parsePrivateClaimPackage(JSON.parse(raw)) : null);
        if (!restored) return;
        claimPackageRef.current = restored;
        setClaimPackage(restored);
        setClaimStep("deployment-needed");
        setClaimMessage(`PayLink verified for ${restored.amountUsdc} USDC. Continue to your recipient wallet.`);
      } catch (error) {
        sessionStorage.removeItem(CLAIM_CONTEXT_KEY);
        setClaimStep("failed");
        setClaimMessage(errorMessage(error));
      }
    });
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreReceipt() {
      const recovered = receiptFromUrl();
      let activeClaim: PrivateClaimPackage | null = null;
      try {
        const linked = parseClaimFragment(window.location.hash);
        const raw = linked ? null : sessionStorage.getItem(CLAIM_CONTEXT_KEY);
        activeClaim = linked ?? (raw ? parsePrivateClaimPackage(JSON.parse(raw)) : null);
      } catch {
        // The claim-context effect reports malformed links. Never let an old receipt hide that error.
      }
      if (recovered) saveConfirmedClaimReceipt(localStorage, RECEIPT_NETWORK, recovered);
      const saved = recovered ?? loadConfirmedClaimReceipt(localStorage, RECEIPT_NETWORK, activeClaim?.escrow);
      if (!saved) {
        if (active) setRestoringReceipt(false);
        return;
      }

      const [transaction, escrowState, escrowAmount] = await Promise.all([
        confirmationClient.getTransactionReceipt({ hash: saved.transactionHash }).catch(() => null),
        confirmationClient.readContract({
          address: getAddress(saved.escrow),
          abi: escrowAbi,
          functionName: "state",
        }).catch(() => null),
        confirmationClient.readContract({
          address: getAddress(saved.escrow),
          abi: escrowAbi,
          functionName: "amount",
        }).catch(() => null),
      ]);
      if (!active) return;
      const receiptConfirmed = transaction?.status === "success";
      if (receiptConfirmed && escrowState === 2 && escrowAmount === BigInt(saved.amountBaseUnits)) {
        setStoredReceipt(saved);
      } else {
        removeConfirmedClaimReceipt(localStorage, RECEIPT_NETWORK, saved.escrow);
      }
      setRestoringReceipt(false);
    }

    void restoreReceipt();
    return () => { active = false; };
  }, []);

  async function confirmClaim(activeClaim: PrivateClaimPackage, recipient: string, submittedHash?: string) {
    const startedAt = Date.now();
    const transactionHash = submittedHash as Hash | undefined;

    while (Date.now() - startedAt < CONFIRMATION_TIMEOUT_MS) {
      if (transactionHash) {
        const receipt = await confirmationClient.getTransactionReceipt({ hash: transactionHash }).catch(() => null);
        if (receipt?.status === "reverted") throw new Error("The Arc claim transaction reverted.");
        if (receipt?.status === "success") return transactionHash;
      }

      const state = await confirmationClient.readContract({
        address: activeClaim.escrow,
        abi: escrowAbi,
        functionName: "state",
      }).catch(() => null);

      if (state === 2) {
        const latestBlock = await confirmationClient.getBlockNumber();
        const fromBlock = latestBlock > 2_000n ? latestBlock - 2_000n : 0n;
        const logs = await confirmationClient.getLogs({
          address: activeClaim.escrow,
          event: escrowAbi[2],
          args: { recipient: getAddress(recipient) },
          fromBlock,
          toBlock: "latest",
        });
        const matchingLog = logs.find((log) => log.args.amount === BigInt(activeClaim.amountBaseUnits));
        if (matchingLog?.transactionHash) return matchingLog.transactionHash;
      }

      await delay(CONFIRMATION_INTERVAL_MS);
    }

    throw new Error("The claim was submitted, but Arc confirmation is taking longer than expected. Check the explorer before retrying.");
  }

  const loadWallet = useCallback(async (userToken: string) => {
    const result = await circleAction<{ wallets?: CircleWallet[] }>({ action: "listWallets", userToken });
    const arcWallet = result.wallets?.find((item) => item.blockchain === circleArcBlockchain);
    if (!arcWallet) throw new Error(`Circle did not return an ${ARC_NETWORK_NAME} wallet.`);
    setWallet(arcWallet);
    setStep("complete");
    setMessage("Your recipient wallet is ready for this PayLink.");
    const activeClaim = claimPackageRef.current;
    if (activeClaim) {
      const bytecode = await confirmationClient.getCode({ address: getAddress(arcWallet.address) }).catch(() => undefined);
      if (bytecode && bytecode !== "0x") {
        setClaimStep("ready");
        setClaimMessage("Recipient wallet is already active on Arc. Prepare the claim authorization.");
      } else {
        setClaimStep("deployment-needed");
        setClaimMessage("Recipient wallet must be activated once on Arc before signing.");
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initializeSdk() {
      try {
        if (!appId || !googleClientId) throw new Error("Circle wallet configuration is incomplete.");
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
        const deviceToken = sessionStorage.getItem(SESSION_KEYS.deviceToken) ?? "";
        const deviceEncryptionKey = sessionStorage.getItem(SESSION_KEYS.deviceEncryptionKey) ?? "";
        const redirectUri = `${window.location.origin}/claim`;

        const sdk = new W3SSdk(
          {
            appSettings: { appId },
            loginConfigs: {
              deviceToken,
              deviceEncryptionKey,
              google: { clientId: googleClientId, redirectUri, selectAccountPrompt: true },
            },
          },
          (error: unknown, result) => {
            if (!active) return;
            if (error) {
              setStep("failed");
              setMessage(errorMessage(error));
              return;
            }
            if (!result?.userToken || !result.encryptionKey) {
              setStep("failed");
              setMessage("Circle login completed without a usable wallet session.");
              return;
            }
            const signedInEmail = (result as SocialLoginResult).oAuthInfo?.socialUserInfo?.email?.trim().toLowerCase();
            const intendedEmail = claimPackageRef.current?.recipientEmail?.trim().toLowerCase();
            if (intendedEmail && signedInEmail !== intendedEmail) {
              setStep("failed");
              setMessage(`This PayLink was sent to ${intendedEmail}. Sign in with that Google account.`);
              return;
            }
            loginRef.current = { userToken: result.userToken, encryptionKey: result.encryptionKey };
            setStep("initializing");
            setMessage("Google verified. Preparing your Arc wallet.");
          },
        );
        sdkRef.current = sdk;
        if (active) {
          setStep("ready");
          setMessage("Sign in with Google to create or recover your recipient wallet.");
        }
      } catch (error) {
        if (active) {
          setStep("failed");
          setMessage(errorMessage(error));
        }
      }
    }

    void initializeSdk();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step !== "initializing" || !loginRef.current) return;
    let active = true;

    async function initializeUser() {
      const login = loginRef.current!;
      try {
        const result = await circleAction<{ challengeId?: string }>({ action: "initializeUser", userToken: login.userToken });
        if (!result.challengeId) throw new Error("Circle did not return a wallet-creation challenge.");
        if (!active || !sdkRef.current) return;
        challengeRef.current = result.challengeId;
        setStep("challenge-ready");
        setMessage("Google verified. Create your Arc wallet to continue.");
      } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code === 155106) {
          await loadWallet(login.userToken);
          return;
        }
        if (active) {
          setStep("failed");
          setMessage(errorMessage(error));
        }
      }
    }

    void initializeUser();
    return () => { active = false; };
  }, [loadWallet, step]);

  function createWallet() {
    const sdk = sdkRef.current;
    const login = loginRef.current;
    const challengeId = challengeRef.current;
    if (!sdk || !login || !challengeId) {
      setStep("failed");
      setMessage("Wallet creation session is incomplete. Please start again.");
      return;
    }

    setStep("creating");
    setMessage("Approve wallet creation in Circle's secure confirmation window.");
    sdk.setAuthentication(login);
    sdk.execute(challengeId, (error: unknown) => {
      if (error) {
        setStep("failed");
        setMessage(errorMessage(error));
        return;
      }
      challengeRef.current = null;
      window.setTimeout(() => void loadWallet(login.userToken).catch((loadError) => {
        setStep("failed");
        setMessage(errorMessage(loadError));
      }), 2000);
    });
  }

  async function signIn() {
    const sdk = sdkRef.current;
    if (!sdk) return;
    try {
      setStep("authenticating");
      setMessage("Opening Google sign-in.");
      const deviceId = await sdk.getDeviceId();
      const tokens = await circleAction<{ deviceToken: string; deviceEncryptionKey: string }>({
        action: "createDeviceToken",
        deviceId,
      });
      sessionStorage.setItem(SESSION_KEYS.deviceToken, tokens.deviceToken);
      sessionStorage.setItem(SESSION_KEYS.deviceEncryptionKey, tokens.deviceEncryptionKey);
      sdk.updateConfigs({
        appSettings: { appId },
        loginConfigs: {
          deviceToken: tokens.deviceToken,
          deviceEncryptionKey: tokens.deviceEncryptionKey,
          google: { clientId: googleClientId, redirectUri: `${window.location.origin}/claim`, selectAccountPrompt: true },
        },
      });
      sdk.performLogin(SocialLoginProvider.GOOGLE);
    } catch (error) {
      setStep("failed");
      setMessage(errorMessage(error));
    }
  }

  async function loadClaimPackage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parsePrivateClaimPackage(JSON.parse(await file.text()));
      claimPackageRef.current = parsed;
      setClaimPackage(parsed);
      setClaimStep("deployment-needed");
      setClaimMessage(`Private package verified for ${parsed.amountUsdc} USDC. Deploy the recipient wallet once before signing.`);
    } catch (error) {
      setClaimStep("failed");
      setClaimMessage(errorMessage(error));
    } finally {
      event.target.value = "";
    }
  }

  async function prepareSignature() {
    const login = loginRef.current;
    const activeClaim = claimPackageRef.current;
    if (!login || !wallet || !activeClaim) return;
    try {
      setClaimStep("preparing-signature");
      setClaimMessage("Preparing the exact escrow authorization.");
      const result = await circleAction<{ challengeId?: string; deadline?: number }>({
        action: "signClaim",
        userToken: login.userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
        ...publicClaimContext(activeClaim),
      });
      if (!result.challengeId || !result.deadline) throw new Error("Circle did not return a signing challenge.");
      claimChallengeRef.current = result.challengeId;
      claimDeadlineRef.current = result.deadline;
      setClaimStep("signature-ready");
      setClaimMessage("Authorization is ready. Review and approve it in Circle.");
    } catch (error) {
      setClaimStep("failed");
      setClaimMessage(errorMessage(error));
    }
  }

  async function prepareDeployment() {
    const login = loginRef.current;
    const activeClaim = claimPackageRef.current;
    if (!login || !wallet || !activeClaim) return;
    try {
      setClaimStep("preparing-deployment");
      setClaimMessage("Preparing the one-time Arc wallet deployment.");
      const result = await circleAction<{ challengeId?: string }>({
        action: "deployWallet",
        idempotencyKey: clientIdempotencyKey(sessionStorage, operationScope("deploy", activeClaim.paymentId)),
        userToken: login.userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
        ...publicClaimContext(activeClaim),
      });
      if (!result.challengeId) throw new Error("Circle did not return a wallet deployment challenge.");
      claimChallengeRef.current = result.challengeId;
      setClaimStep("deployment-ready");
      setClaimMessage("Wallet deployment is ready. This moves 0 USDC and only activates the SCA on Arc.");
    } catch (error) {
      setClaimStep("failed");
      setClaimMessage(errorMessage(error));
    }
  }

  function approveDeployment() {
    const sdk = sdkRef.current;
    const login = loginRef.current;
    const challengeId = claimChallengeRef.current;
    if (!sdk || !login || !challengeId) return;
    setClaimStep("deploying");
    setClaimMessage("Approve the one-time wallet deployment in Circle.");
    sdk.setAuthentication(login);
    sdk.execute(challengeId, (error: unknown) => {
      if (error) {
        setClaimStep("failed");
        setClaimMessage(errorMessage(error));
        return;
      }
      claimChallengeRef.current = null;
      window.setTimeout(() => {
        void prepareSignature();
      }, 2500);
    });
  }

  function approveSignature() {
    const sdk = sdkRef.current;
    const login = loginRef.current;
    const challengeId = claimChallengeRef.current;
    if (!sdk || !login || !challengeId) return;
    setClaimStep("signing");
    setClaimMessage("Approve the address-bound claim authorization in Circle.");
    sdk.setAuthentication(login);
    sdk.execute(challengeId, async (error: unknown, result) => {
      if (error) {
        setClaimStep("failed");
        try {
          const detail = await circleAction<{
            challenge?: { errorCode?: number; errorMessage?: string; status?: string };
          }>({
            action: "inspectChallenge",
            userToken: login.userToken,
            challengeId,
          });
          const challenge = detail.challenge;
          const suffix = [challenge?.errorCode, challenge?.errorMessage, challenge?.status].filter(Boolean).join(" · ");
          if (challenge?.errorCode === 155517) {
            setClaimStep("deployment-needed");
            setClaimMessage("Recipient wallet must be deployed once before it can sign.");
          } else {
            setClaimMessage(suffix || errorMessage(error));
          }
        } catch {
          setClaimMessage(errorMessage(error));
        }
        return;
      }
      const signature = result && "data" in result ? result.data?.signature : undefined;
      if (!signature) {
        setClaimStep("failed");
        setClaimMessage("Circle completed without returning the claim signature.");
        return;
      }
      claimChallengeRef.current = null;
      claimSignatureRef.current = signature;
      void prepareClaim();
    });
  }

  async function prepareClaim() {
    const login = loginRef.current;
    const activeClaim = claimPackageRef.current;
    const signature = claimSignatureRef.current;
    const deadline = claimDeadlineRef.current;
    if (!login || !wallet || !activeClaim || !signature || !deadline) return;
    try {
      setClaimStep("preparing-claim");
      setClaimMessage(`Preparing the final ${ARC_NETWORK_NAME} transaction.`);
      const result = await circleAction<{ challengeId?: string }>({
        action: "executeClaim",
        idempotencyKey: clientIdempotencyKey(sessionStorage, operationScope("claim", activeClaim.paymentId)),
        userToken: login.userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
        ...publicClaimContext(activeClaim),
        secret: activeClaim.secret,
        signature,
        deadline,
      });
      if (!result.challengeId) throw new Error("Circle did not return a claim transaction challenge.");
      claimChallengeRef.current = result.challengeId;
      setClaimStep("claim-ready");
      setClaimMessage(`Final transaction is ready. Approving it will claim ${activeClaim.amountUsdc} USDC.`);
    } catch (error) {
      setClaimStep("failed");
      setClaimMessage(errorMessage(error));
    }
  }

  function approveClaim() {
    const sdk = sdkRef.current;
    const login = loginRef.current;
    const challengeId = claimChallengeRef.current;
    if (!sdk || !login || !challengeId) return;
    setClaimStep("claiming");
    setClaimMessage(`Approve the final ${claimPackageRef.current?.amountUsdc ?? "USDC"} claim in Circle.`);
    sdk.setAuthentication(login);
    sdk.execute(challengeId, async (error: unknown, result) => {
      if (error) {
        setClaimStep("failed");
        setClaimMessage(errorMessage(error));
        return;
      }
      const txHash = result && "data" in result && result.data && "txHash" in result.data
        ? result.data.txHash
        : undefined;
      claimChallengeRef.current = null;
      const activeClaim = claimPackageRef.current;
      if (!activeClaim || !wallet) {
        setClaimStep("failed");
        setClaimMessage("The claim was submitted, but its confirmation context was lost.");
        return;
      }
      setClaimStep("confirming");
      setClaimMessage(`Claim submitted on ${ARC_NETWORK_NAME}. Waiting for on-chain confirmation.`);
      try {
        const confirmedHash = await confirmClaim(activeClaim, wallet.address, txHash);
        const receipt: ConfirmedClaimReceipt = {
          transactionHash: confirmedHash,
          recipient: wallet.address,
          escrow: activeClaim.escrow,
          amountUsdc: activeClaim.amountUsdc,
          amountBaseUnits: activeClaim.amountBaseUnits,
          confirmedAt: new Date().toISOString(),
        };
        saveConfirmedClaimReceipt(localStorage, RECEIPT_NETWORK, receipt);
        sessionStorage.removeItem(CLAIM_CONTEXT_KEY);
        clearClientIdempotencyKey(sessionStorage, operationScope("deploy", activeClaim.paymentId));
        clearClientIdempotencyKey(sessionStorage, operationScope("claim", activeClaim.paymentId));
        setStoredReceipt(receipt);
        setClaimTxHash(confirmedHash);
        claimPackageRef.current = null;
        claimSignatureRef.current = null;
        setClaimStep("claimed");
        setClaimMessage(`${activeClaim.amountUsdc} USDC claimed and confirmed on ${ARC_NETWORK_NAME}.`);
      } catch (confirmationError) {
        setClaimStep("failed");
        setClaimMessage(errorMessage(confirmationError));
      }
    });
  }

  return (
    <section className="wallet-panel" aria-labelledby="wallet-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Recipient onboarding</p><h2 id="wallet-heading">Claim without a wallet</h2></div>
        <span className="step">Circle · Google</span>
      </div>
      <p className="wallet-copy">Sign in with Google. Circle creates a user-controlled Arc wallet for you; Arc PayLink never receives your private keys.</p>
      {restoringReceipt && (
        <div className="status-box" role="status">
          <b>Checking for a previous confirmed claim.</b><span className="spinner" />
        </div>
      )}
      {!restoringReceipt && storedReceipt && (
        <>
          <div className="status-box paid" role="status">
            <b>{storedReceipt.amountUsdc} USDC claimed and confirmed on {ARC_NETWORK_NAME}.</b>
          </div>
          <dl className="payment-details wallet-details">
            <div><dt>Network</dt><dd>{ARC_NETWORK_NAME}</dd></div>
            <div><dt>Recipient wallet</dt><dd className="mono">{storedReceipt.recipient}</dd></div>
            <div><dt>Claim amount</dt><dd>{storedReceipt.amountUsdc} USDC</dd></div>
            <div><dt>Escrow</dt><dd className="mono">{storedReceipt.escrow.slice(0, 8)}…{storedReceipt.escrow.slice(-6)}</dd></div>
          </dl>
          <a className="explorer-link mono" href={`${ARC_EXPLORER_URL}/tx/${storedReceipt.transactionHash}`} target="_blank" rel="noreferrer">
            Confirmed · View transaction ↗
          </a>
          <button className="text-button" onClick={() => {
            removeConfirmedClaimReceipt(localStorage, RECEIPT_NETWORK, storedReceipt.escrow);
            setStoredReceipt(null);
          }}>Claim a different PayLink</button>
        </>
      )}
      {!restoringReceipt && !storedReceipt && (
        <>
      <div className={`status-box ${step === "failed" ? "failed" : step === "complete" ? "paid" : ""}`} role="status">
        <b>{message}</b>
        {!["ready", "challenge-ready", "complete", "failed"].includes(step) && <span className="spinner" />}
      </div>
      {step === "ready" && <button className="primary-button full" onClick={signIn}>Continue with Google <span aria-hidden>→</span></button>}
      {step === "challenge-ready" && <button className="primary-button full" onClick={createWallet}>Create Arc wallet <span aria-hidden>→</span></button>}
      {step === "failed" && <button className="text-button" onClick={() => window.location.reload()}>Start again</button>}
      {wallet && (
        <>
          <dl className="payment-details wallet-details">
            <div><dt>Network</dt><dd>{wallet.blockchain}</dd></div>
            {claimPackage?.title && <div><dt>Payment</dt><dd>{claimPackage.title}</dd></div>}
            {claimPackage?.reference && <div><dt>Reference</dt><dd className="mono">{claimPackage.reference}</dd></div>}
            {claimPackage?.recipientEmail && <div><dt>Sent to</dt><dd>{claimPackage.recipientEmail}</dd></div>}
            <div><dt>Recipient wallet</dt><dd className="mono">{wallet.address}</dd></div>
            {claimPackage && <div><dt>Claim amount</dt><dd>{claimPackage.amountUsdc} USDC</dd></div>}
            {claimPackage && <div><dt>Escrow</dt><dd className="mono">{claimPackage.escrow.slice(0, 8)}…{claimPackage.escrow.slice(-6)}</dd></div>}
          </dl>
          <div className={`status-box ${claimStep === "failed" ? "failed" : claimStep === "claimed" ? "paid" : ""}`} role="status">
            <b>{claimMessage}</b>
            {["preparing-deployment", "deploying", "preparing-signature", "signing", "preparing-claim", "claiming", "confirming"].includes(claimStep) && <span className="spinner" />}
          </div>
          {claimStep === "package-needed" && (
            <label className="primary-button full file-button">
              Load private claim package
              <input type="file" accept="application/json,.json" onChange={loadClaimPackage} />
            </label>
          )}
          {claimStep === "ready" && <button className="primary-button full" onClick={prepareSignature}>Prepare authorization <span aria-hidden>→</span></button>}
          {claimStep === "deployment-needed" && <button className="primary-button full" onClick={prepareDeployment}>Deploy recipient wallet <span aria-hidden>→</span></button>}
          {claimStep === "deployment-ready" && <button className="primary-button full" onClick={approveDeployment}>Approve wallet deployment <span aria-hidden>→</span></button>}
          {claimStep === "signature-ready" && <button className="primary-button full" onClick={approveSignature}>Approve authorization <span aria-hidden>→</span></button>}
          {claimStep === "signed" && <button className="primary-button full" onClick={prepareClaim}>Prepare {claimPackage?.amountUsdc ?? "USDC"} claim <span aria-hidden>→</span></button>}
          {claimStep === "claim-ready" && <button className="primary-button full" onClick={approveClaim}>Approve {claimPackage?.amountUsdc ?? "USDC"} claim <span aria-hidden>→</span></button>}
          {claimStep === "failed" && <button className="text-button" onClick={() => window.location.reload()}>Start again</button>}
          {claimTxHash && (
            <a className="explorer-link mono" href={`${ARC_EXPLORER_URL}/tx/${claimTxHash}`} target="_blank" rel="noreferrer">
              Confirmed · View transaction ↗
            </a>
          )}
        </>
      )}
        </>
      )}
      <p className="security-note">Google verifies the intended account in this app. Circle secures the wallet. The private link remains a bearer secret; do not forward it.</p>
    </section>
  );
}
