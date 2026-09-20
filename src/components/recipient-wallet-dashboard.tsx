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
type TransferReview = { recipient: `0x${string}`; amount: string };
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
  const [transferReview, setTransferReview] = useState<TransferReview | null>(null);
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
      sdk.updateConfigs({ appSettings: { appId }, loginConfigs: { deviceToken: tokens.deviceEncryptionKey, google: { clientId: googleClientId, redirectUri: `${window.location.origin}/wallet`, selectAccountPrompt: true } } });
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
      const normalizedRecipient = getAddress(recipient);
      const normalizedAmount = formatUnits(units, 6);
      const result = await circleAction<{ challengeId?: string }>({
        action: "transferUsdc", userToken: login.userToken, walletId: wallet.id, walletAddress: wallet.address,
        recipient: normalizedRecipient, amountBaseUnits: units.toString(), idempotencyKey: crypto.randomUUID(),
      });
      if (!result.challengeId) throw new Error("Circle did not return a transfer challenge.");
      challengeRef.current = result.challengeId;
      setTransferReview({ recipient: normalizedRecipient, amount: normalizedAmount });
      setStatus("approval"); setMessage("Verify every transfer detail before opening Circle's secure approval.");
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
      setTxHash���͠��͕�Mх��̠������ɵ������͕�5��ͅ����QɅ�͙�ȁ�Չ���ѕ���]��ѥ�����ȁɌ������ɵ�ѥ������(����������(������������Ёɕ����Ѐ�݅�Ё�����й݅����QɅ�ͅ�ѥ��I�����С쁡�͠��ѥ���������|�������(������������ɕ����й�х��̀����Ս���̈��ѡɽ܁��܁�ɽȠ�Q���Ɍ��Ʌ�͙�ȁɕٕ�ѕ�����(���������݅�Ёɕ�ɕ͡	�������݅���й���ɕ�̤�(��������͕���չР����͕�I�������Р����͕�Mх��̠�͕�Ј��͕�5��ͅ����UM�͕�Ё���������ɵ������Ɍ����(������􁍅э��������ɵ�ѥ���ɽȤ��͕�Mх��̠����������͕�5��ͅ������ͅ��=�������ɵ�ѥ���ɽȤ���(�������(���((���չ�ѥ�������QɅ�͙�Ƞ���(�������������I������ɕ�Ѐ�ձ��(����͕�QɅ�͙��I�٥�ܡ�ձ���(����͕�Mх��̠���ѥٔ���(����͕�5��ͅ����QɅ�͙�ȁ���ɽم���������������Ёѡ�����ѥ��ѥ����ȁ���չа�ѡ���ɕ٥�܁���������(���((������Ё�����l��������������ѡ��ѥ��ѥ��������������݅���Ј����ɕ��ɥ�������Չ���ѥ�����������ɵ����t�����Ց�̡�х��̤�(��ɕ��ɸ��͕�ѥ��������9����݅���е��������ɥ�������������݅���е��͡���ɐ����������(�����؁�����9������������������������������9����啉ɽ܈�I�������Ё݅��������ȁ���݅���е��͡���ɐ����������e��ȁɌ�݅�������𽑥�������������9�����ѕ���
�ɍ���
܁�����������𽑥��(������������9����݅���е���������́ѡ��݅���Ё�ɕ�ѕ����ɥ�����ȁ�������Ɍ�A��1������ٕȁɕ���ٕ́��́�ɥمє����̸���(�����؁�����9������х��̵�������х��̀��􀉙��������������������х��̀���͕�Ј����������聉���������������耈����ɽ����х��̈�����ͅ������䀘�������������9����������Ȉ����𽑥��(������х��̀���ɕ��䈀������ѽ�������9�����ɥ���䵉��ѽ���ձ�����
�����젤����ٽ���ͥ��%�����
��ѥ�Ք�ݥѠ��������������H���������ѽ���(�����݅���Ѐ�����(������񑰁�����9������嵕�е��х��́݅���е��х��̈�(��������������9��ݽɬ������I
}9Q]=I-}95�𽑐�𽑥��(��������������]��������񑐁�����9���􉵽���݅���е���ɕ�̈��݅���й���ɕ���𽑐�𽑥��(��������������م����������������������ɽ���홽ɵ��U���̡���������إ�UM���ɽ���𽑐�𽑥��(������𽑰�(��������х��̀��􀉅��ɽم�������х��̀����Չ���ѥ��������ɴ������9����ɕ�Օ�е��ɴ����MՉ����졕ٕ�Ф����ٽ����ɕ��ɕQɅ�͙�ȡ�ٕ�Х��(��������񱅉�����ѥ��ѥ���Ɍ����ɕ�����Ёم�Ք��ɕ�������􁽹
������졕ٕ�Ф����͕�I�������С�ٕ�йхɝ�йم�Ք���������������ุ���ɕ�եɕ����𽱅����(��������񱅉���UM����չ��؁�����9���􉅵�չе����Ј����Ёم�Ք�텵�չ�􁽹
������졕ٕ�Ф����͕���չС�ٕ�йхɝ�йم�Ք�􁥹���5���􉑕�������������������������ɕ�եɕ������UM��𽑥��𽱅����(�����������ѽ�������9�����ɥ���䵉��ѽ���ձ�����ͅ���������������������������I�٥�܁�Ʌ�͙�Ȁ�������H���������ѽ��(������𽙽ɴ��(��������х��̀��􀉅��ɽم�������Ʌ�͙��I�٥�܀�����(��������񑰁�����9������嵕�е��х��̈��ɥ��������QɅ�͙�ȁɕ٥�܈�(����������������ɽ��݅�������񑐁�����9���􉵽���݅���е���ɕ�̈��݅���й���ɕ���𽑐�𽑥��(������������������ѥ��ѥ�����񑐁�����9���􉵽���݅���е���ɕ�̈���Ʌ�͙��I�٥�ܹɕ��������𽑐�𽑥��(������������������չ���������ɽ�����Ʌ�͙��I�٥�ܹ���չ��UM���ɽ���𽑐�𽑥��(����������������9��ݽɬ������I
}9Q]=I-}95�𽑐�𽑥��(��������𽑰�(���������؁�����9�����Ʌ�͙�ȵ��ѥ��̈�(�������������ѽ�������9�����ɥ���䵉��ѽ���ձ�����
��������ɽٕQɅ�͙������ɽٔ���Ʌ�͙��I�٥�ܹ���չ��UM��Ʌ�͙�Ȁ�������H���������ѽ��(�������������ѽ�������9����͕������䵉��ѽ���ձ����������ѽ�����
�����핑��QɅ�͙����	�����������Ё�Ʌ�͙�����ѽ��(��������𽑥��(���������(���������!�͠����񄁍����9��������ɕȵ������������ɕ��퀑�I
}aA1=II}UI1���༑���!�͡���хɝ���}�������ɕ�􉹽ɕ���ɕȈ�Y��܁�Ʌ�ͅ�ѥ������ɍM�����\���(���������ѽ�������9����ѕ�е���ѽ�����ͅ���������􁽹
�����젤����ٽ���ɕ�ɕ͡	�������݅���й���ɕ�̤���э�����ɽȤ�����͕�Mх��̠����������͕�5��ͅ������ͅ��=����ɽȤ������I��ɕ͠�����������ѽ��(�������(������������9����͕��ɥ�䵹�є��=��䁅��ɽٔ�ѡ�����ѥ��ѥ����������չЁ�ԁ��ѕ���Ѽ�͕����QɅ�͙��́�����ɵ������Ɍ������Ё���ɕٕ�͕�����(���͕�ѥ����)�(
