"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CustomerCheckout, CHECKOUT_RETURN } from "./customer-checkout";
export function WalletEntry({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = sessionStorage.getItem(CHECKOUT_RETURN);
        const parsed = raw ? JSON.parse(raw) : undefined;
        if (
          parsed &&
          /^[0-9a-f-]{36}$/.test(parsed.orderId) &&
          Date.now() - parsed.startedAt < 30 * 60_000
        ) {
          setTarget(parsed.orderId);
          return;
        }
      } catch {
        /* Fall through to the existing recipient wallet. */
      }
      sessionStorage.removeItem(CHECKOUT_RETURN);
      setTarget(null);
    });
  }, []);
  if (target === undefined)
    return <p style={{ padding: 32 }}>Loading secure account…</p>;
  return target ? (
    <>
      <CustomerCheckout key={target} orderId={target} />
      <button
        style={{ margin: 20 }}
        onClick={() => {
          sessionStorage.removeItem(CHECKOUT_RETURN);
          window.location.reload();
        }}
      >
        Leave checkout and open my wallet
      </button>
    </>
  ) : (
    children
  );
}
