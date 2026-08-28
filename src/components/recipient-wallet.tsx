"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type LoginResult = { userToken: string; encryptionKey: string };
type CircleWallet = { id: string; address: string; blockchain: string };
type Step = "loading" | "ready" | "authenticating" | "initializing" | "creating" | "complete" | "failed";

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
  const [step, setStep] = useState<Step>("loading");
  const [message, setMessage] = useState("Preparing secure Google sign-in.");
  const [wallet, setWallet] = useState<CircleWallet | null>(null);

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
        setStep("creating");
        setMessage("Approve wallet creation in Circle's secure confirmation window.");
        sdkRef.current.setAuthentication(login);
        sdkRef.current.execute(result.challengeId, (error: unknown) => {
          if (!active) return;
          if (error) {
            setStep("failed");
            setMessage(errorMessage(error));
            return;
          }
          window.setTimeout(() => void loadWallet(login.userToken).catch((loadError) => {
            setStep("failed");
            setMessage(errorMessage(loadError));
          }), 1500);
        });
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

  return (
    <section className="wallet-panel" aria-labelledby="wallet-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">Recipient onboarding</p><h2 id="wallet-heading">Claim without a wallet</h2></div>
        <span className="step">Circle · Google</span>
      </div>
      <p className="wallet-copy">Sign in with Google. Circle creates a user-controlled Arc wallet for you; Arc PayLink never receives your private keys.</p>
      <div className={`status-box ${step === "failed" ? "failed" : step === "complete" ? "paid" : ""}`} role="status">
        <b>{message}</b>
        {!["ready", "complete", "failed"].includes(step) && <span className="spinner" />}
      </div>
      {step === "ready" && <button className="primary-button full" onClick={signIn}>Continue with Google <span aria-hidden>→</span></button>}
      {step === "failed" && <button className="text-button" onClick={() => window.location.reload()}>Start again</button>}
      {wallet && (
        <dl className="payment-details wallet-details">
          <div><dt>Network</dt><dd>{wallet.blockchain}</dd></div>
          <div><dt>Recipient wallet</dt><dd className="mono">{wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</dd></div>
        </dl>
      )}
      <p className="security-note">Google authenticates you. Circle secures the wallet. The next step will bind this address to the escrow claim.</p>
    </section>
  );
}
