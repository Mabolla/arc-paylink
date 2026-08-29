"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { bytesToHex, isHex, keccak256 } from "viem";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type LoginResult = { userToken: string; encryptionKey: string };
type CircleWallet = { id: string; address: string; blockchain: string };
type Step = "loading" | "ready" | "authenticating" | "initializing" | "challenge-ready" | "creating" | "complete" | "failed";
type ClaimStep = "package-needed" | "ready" | "deployment-needed" | "preparing-deployment" | "deployment-ready" | "deploying" | "preparing-signature" | "signature-ready" | "signing" | "signed" | "preparing-claim" | "claim-ready" | "claiming" | "claimed" | "failed";

const claimSecretHash = "0xce575f7157960804eb20b1671d66b24ae89ab937173f667771334474759347c0";

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
  const claimSecretRef = useRef<`0x${string}` | null>(null);
  const claimSignatureRef = useRef<string | null>(null);
  const claimDeadlineRef = useRef<number | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [message, setMessage] = useState("Preparing secure Google sign-in.");
  const [wallet, setWallet] = useState<CircleWallet | null>(null);
  const [claimStep, setClaimStep] = useState<ClaimStep>("package-needed");
  const [claimMessage, setClaimMessage] = useState("Load the private PayLink package to unlock this claim.");
  const [claimTxHash, setClaimTxHash] = useState("");

  const loadWallet = useCallback(async (userToken: string) => {
    const result = await circleAction<{ wallets?: CircleWallet[] }>({ action: "listWallets", userToken });
    const arcWallet = result.wallets?.find((item) => item.blockchain === "ARC-TESTNET") ?? result.wallets?.[0];
    if (!arcWallet) throw new Error("Circle did not return an Arc Testnet wallet.");
    setWallet(arcWallet);
    setStep("complete");
    setMessage("Your recipient wallet is ready for this PayLink.");
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
      const secret = file.name.toLowerCase().endsWith(".bin")
        ? bytesToHex(new Uint8Array(await file.arrayBuffer()))
        : (JSON.parse(await file.text()) as { secret?: unknown }).secret;
      if (typeof secret !== "string" || !isHex(secret) || secret.length !== 66) {
        throw new Error("This is not a valid Arc PayLink claim package.");
      }
      if (keccak256(secret) !== claimSecretHash) {
        throw new Error("This package belongs to a different PayLink.");
      }
      claimSecretRef.current = secret;
      setClaimStep("deployment-needed");
      setClaimMessage("Private package verified. Deploy the recipient wallet once before signing.");
    } catch (error) {
      setClaimStep("failed");
      setClaimMessage(errorMessage(error));
    } finally {
      event.target.value = "";
    }
  }

  async function prepareSignature() {
    const login = loginRef.current;
    if (!login || !wallet || !claimSecretRef.current) return;
    try {
      setClaimStep("preparing-signature");
      setClaimMessage("Preparing the exact escrow authorization.");
      const result = await circleAction<{ challengeId?: string; deadline?: number }>({
        action: "signClaim",
        userToken: login.userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
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
    if (!login || !wallet) return;
    try {
      setClaimStep("preparing-deployment");
      setClaimMessage("Preparing the one-time Arc wallet deployment.");
      const result = await circleAction<{ challengeId?: string }>({
        action: "deployWallet",
        userToken: login.userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
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
        setClaimStep("ready");
        setClaimMessage("Recipient wallet deployed. Prepare the address-bound authorization.");
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
      setClaimStep("signed");
      setClaimMessage("Authorization signed. Prepare the final 1 USDC claim transaction.");
    });
  }

  async function prepareClaim() {
    const login = loginRef.current;
    const secret = claimSecretRef.current;
    const signature = claimSignatureRef.current;
    const deadline = claimDeadlineRef.current;
    if (!login || !wallet || !secret || !signature || !deadline) return;
    try {
      setClaimStep("preparing-claim");
      setClaimMessage("Preparing the final Arc Testnet transaction.");
      const result = await circleAction<{ challengeId?: string }>({
        action: "executeClaim",
        userToken: login.userToken,
        walletId: wallet.id,
        walletAddress: wallet.address,
        secret,
        signature,
        deadline,
      });
      if (!result.challengeId) throw new Error("Circle did not return a claim transaction challenge.");
      claimChallengeRef.current = result.challengeId;
      setClaimStep("claim-ready");
      setClaimMessage("Final transaction is ready. Approving it will claim 1 USDC.");
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
    setClaimMessage("Approve the final 1 USDC claim in Circle.");
    sdk.setAuthentication(login);
    sdk.execute(challengeId, (error: unknown, result) => {
      if (error) {
        setClaimStep("failed");
        setClaimMessage(errorMessage(error));
        return;
      }
      const txHash = result && "data" in result && result.data && "txHash" in result.data
        ? result.data.txHash
        : undefined;
      claimChallengeRef.current = null;
      claimSecretRef.current = null;
      claimSignatureRef.current = null;
      if (txHash) setClaimTxHash(txHash);
      setClaimStep("claimed");
      setClaimMessage("Claim submitted on Arc Testnet. Your 1 USDC is on the way.");
    });
  }

  return (
    <section className="wallet-panel" aria-labelledby="wallet-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Recipient onboarding</p><h2 id="wallet-heading">Claim without a wallet</h2></div>
        <span className="step">Circle · Google</span>
      </div>
      <p className="wallet-copy">Sign in with Google. Circle creates a user-controlled Arc wallet for you; Arc PayLink never receives your private keys.</p>
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
            <div><dt>Recipient wallet</dt><dd className="mono">{wallet.address}</dd></div>
          </dl>
          <div className={`status-box ${claimStep === "failed" ? "failed" : claimStep === "claimed" ? "paid" : ""}`} role="status">
            <b>{claimMessage}</b>
            {["preparing-deployment", "deploying", "preparing-signature", "signing", "preparing-claim", "claiming"].includes(claimStep) && <span className="spinner" />}
          </div>
          {claimStep === "package-needed" && (
            <label className="primary-button full file-button">
              Load private claim package
              <input type="file" accept="application/octet-stream,.bin,application/json,.json" onChange={loadClaimPackage} />
            </label>
          )}
          {claimStep === "ready" && <button className="primary-button full" onClick={prepareSignature}>Prepare authorization <span aria-hidden>→</span></button>}
          {claimStep === "deployment-needed" && <button className="primary-button full" onClick={prepareDeployment}>Deploy recipient wallet <span aria-hidden>→</span></button>}
          {claimStep === "deployment-ready" && <button className="primary-button full" onClick={approveDeployment}>Approve wallet deployment <span aria-hidden>→</span></button>}
          {claimStep === "signature-ready" && <button className="primary-button full" onClick={approveSignature}>Approve authorization <span aria-hidden>→</span></button>}
          {claimStep === "signed" && <button className="primary-button full" onClick={prepareClaim}>Prepare 1 USDC claim <span aria-hidden>→</span></button>}
          {claimStep === "claim-ready" && <button className="primary-button full" onClick={approveClaim}>Approve 1 USDC claim <span aria-hidden>→</span></button>}
          {claimStep === "failed" && <button className="text-button" onClick={() => window.location.reload()}>Start again</button>}
          {claimTxHash && <p className="security-note mono">Transaction: {claimTxHash}</p>}
        </>
      )}
      <p className="security-note">Google authenticates you. Circle secures the wallet. The next step will bind this address to the escrow claim.</p>
    </section>
  );
}
