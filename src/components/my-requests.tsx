"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { managedRequestReferences, saveManagedRequestReference, type ManagedRequestReference } from "@/lib/managed-request-client";
import type { RequestView } from "@/lib/request-lifecycle";

type Item = ManagedRequestReference & { view: RequestView };

export function MyRequests() {
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("Loading requests…");

  async function refresh() {
    const references = managedRequestReferences(window.localStorage);
    const loaded = (await Promise.all(references.map(async (reference) => {
      const response = await fetch(`/api/requests/${reference.requestId}`, { cache: "no-store" });
      if (!response.ok) return undefined;
      return { ...reference, view: (await response.json()).view as RequestView };
    }))).filter((item): item is Item => Boolean(item));
    setItems(loaded);
    setMessage(loaded.length ? "" : "No managed requests are stored in this browser.");
  }

  useEffect(() => { queueMicrotask(() => void refresh()); }, []);

  async function post(path: string, body: object) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { response, result: await response.json() as { requestId?: string; managementToken?: string; error?: string } };
  }

  async function revoke(item: Item) {
    const { response, result } = await post(`/api/requests/${item.requestId}/revoke`, { managementToken: item.managementToken });
    setMessage(response.ok ? "Request revoked." : result.error ?? "Revoke failed.");
    await refresh();
  }

  async function replace(event: React.FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { response, result } = await post(`/api/requests/${item.requestId}/replace`, { managementToken: item.managementToken, title: form.get("title"), amount: form.get("amount"), recipient: form.get("recipient"), route: item.view.request.route, obligationKind: item.view.request.obligation?.kind, obligationId: form.get("obligationId") });
    if (response.ok && result.requestId && result.managementToken) {
      saveManagedRequestReference(window.localStorage, { requestId: result.requestId, managementToken: result.managementToken });
      setMessage("Replacement created; the old link is revoked.");
    } else setMessage(result.error ?? "Replacement failed.");
    await refresh();
  }

  async function verifySettlement(event: React.FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    const transactionHash = String(new FormData(event.currentTarget).get("transactionHash") ?? "");
    setMessage("Verifying the Arc receipt and exact USDC transfer…");
    const { response, result } = await post(`/api/requests/${item.requestId}/settle`, { transactionHash });
    setMessage(response.ok ? "Settlement verified from Arc." : result.error ?? "Settlement verification failed.");
    await refresh();
  }

  return <section className="requests-list">
    <div className="panel-heading"><div><p className="eyebrow">Creator workspace</p><h1>My Requests</h1></div><Link href="/">New request</Link></div>
    {message && <div className="status-box"><b>{message}</b></div>}
    {items.map((item) => <article className="request-card" key={item.requestId}>
      <div className="receipt-top"><span className={`status-dot ${item.view.status === "settled" ? "paid" : item.view.status === "pending" ? "pending" : "failed"}`} /><span>{item.view.status}</span></div>
      <h2>{item.view.request.title}</h2>
      <dl className="payment-details"><div><dt>Amount</dt><dd>{item.view.request.amount} USDC</dd></div><div><dt>Recipient</dt><dd className="mono">{item.view.request.recipient.slice(0, 8)}…{item.view.request.recipient.slice(-6)}</dd></div><div><dt>Obligation</dt><dd>{item.view.request.obligation?.id}</dd></div></dl>
      <Link className="text-button" href={`/pay/${item.requestId}`}>Open payment link</Link>
      {item.view.status === "pending" && <>
        <details><summary>Verify Arc transaction</summary><form className="request-form compact" onSubmit={(event) => void verifySettlement(event, item)}><input name="transactionHash" placeholder="0x transaction hash" pattern="0x[0-9a-fA-F]{64}" required /><button className="secondary-button full">Verify settlement</button></form></details>
        <button className="secondary-button full" onClick={() => void revoke(item)}>Revoke request</button>
        <details><summary>Revoke and replace</summary><form className="request-form compact" onSubmit={(event) => void replace(event, item)}><input name="title" defaultValue={item.view.request.title} required /><input name="amount" defaultValue={item.view.request.amount} required /><input name="recipient" defaultValue={item.view.request.recipient} required /><input name="obligationId" placeholder="New obligation ID" required /><button className="primary-button full">Create replacement</button></form></details>
      </>}
    </article>)}
  </section>;
}
