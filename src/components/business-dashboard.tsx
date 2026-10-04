"use client";
import Link from "next/link";
import { CollectionsMonitorStatus } from "./collections-monitor-status";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import { ARC_EXPLORER_URL, ARC_NETWORK_NAME } from "@/lib/arc";
import { parseUsdcAmount, normalizeUsdcAmount } from "@/lib/amount";
import {
  demoOrders,
  demoWorkspace,
  saveDemoOrders,
  type DashboardOrder,
} from "@/lib/commerce/demo-client";
import type { Workspace } from "@/lib/commerce/types";
import styles from "./business.module.css";

type Key = { id: string; name: string; role: string; revokedAt?: string };
type Summary = {
  count: number;
  paidCount: number;
  processing: number;
  overdue: number;
  paidUsdc: string;
  outstandingUsdc: string;
};
async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/business/${path}`, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error ?? "Request failed.");
  return value;
}
function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(orders: DashboardOrder[]) {
  const cell = (v: unknown) =>
    `"${String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  return [
    [
      "reference",
      "customer",
      "title",
      "amount_usdc",
      "status",
      "created_at",
      "transaction_hash",
    ],
    ...orders.map((o) => [
      o.reference,
      o.customerReference,
      o.title,
      o.amount,
      o.status,
      o.createdAt,
      o.receipt?.transactionHash,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}

export function BusinessDashboard({ demo = false }: { demo?: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [summary, setSummary] = useState<Summary>();
  const [keys, setKeys] = useState<Key[]>([]);
  const [secret, setSecret] = useState("");
  const [secretKind, setSecretKind] = useState("Owner recovery key");
  const [replacement, setReplacement] = useState<{ token: string; expiresAt: string }>();
  const [replacementSaved, setReplacementSaved] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionBusy, setBusy] = useState(false);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const busy = actionBusy || monitorBusy;
  const [showForm, setShowForm] = useState(false);
  const [login, setLogin] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [agentResult, setAgentResult] = useState("");
  const [storageReady, setStorageReady] = useState(true);
  const [embeddedReady, setEmbeddedReady] = useState(true);
  const [retryKey, setRetryKey] = useState("");
  const [asOf, setAsOf] = useState(0);
  const refresh = useCallback(async () => {
    setAsOf(Date.now());
    if (demo) {
      const list = demoOrders();
      setWorkspace(demoWorkspace);
      setOrders(list);
      const sum = (status: string[]) =>
        formatUnits(
          list
            .filter((o) => status.includes(o.status))
            .reduce((n, o) => n + parseUsdcAmount(o.amount), 0n),
          6,
        );
      setSummary({
        count: list.length,
        paidCount: list.filter((o) => o.status === "paid").length,
        processing: 0,
        overdue: list.filter(
          (o) =>
            o.status === "pending" &&
            o.dueAt &&
            Date.parse(o.dueAt) < Date.now(),
        ).length,
        paidUsdc: sum(["paid"]),
        outstandingUsdc: sum(["pending", "processing"]),
      });
      setLoading(false);
      return;
    }
    const session = await fetch("/api/business/session", { cache: "no-store" });
    if (session.status === 401) {
      setWorkspace(undefined);
      setLoading(false);
      return;
    }
    const data = await session.json();
    if (!session.ok) throw new Error(data.error);
    setWorkspace(data.workspace);
    const [page, totals, keyList] = await Promise.all([
      call<{ orders: DashboardOrder[]; cursor?: string }>("orders"),
      call<Summary>("summary"),
      call<{ keys: Key[] }>("keys"),
    ]);
    setOrders(page.orders);
    setCursor(page.cursor);
    setSummary(totals);
    setKeys(keyList.keys);
    setLoading(false);
  }, [demo]);
  useEffect(() => {
    queueMicrotask(() => {
      void refresh().catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    });
    if (!demo)
      void call<{ storageReady: boolean; embeddedWalletReady: boolean }>(
        "config",
      )
        .then((c) => {
          setStorageReady(c.storageReady);
          setEmbeddedReady(c.embeddedWalletReady);
        })
        .catch(() => {});
  }, [refresh, demo]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function onboarding(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await act(async () => {
      if (login)
        await call("session", { token: String(form.get("token")).trim() });
      else {
        const result = await call<{ workspace: Workspace; token: string }>(
          "workspaces",
          { name: form.get("name"), recipient: form.get("recipient") },
        );
        setSecret(result.token);
        setSecretKind("Owner recovery key");
      }
      await refresh();
    });
  }
  async function createOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    await act(async () => {
      const idempotencyKey = retryKey || crypto.randomUUID();
      setRetryKey(idempotencyKey);
      const body = {
        title: String(form.get("title")),
        reference: String(form.get("reference")),
        amount: String(form.get("amount")),
        customerReference: String(form.get("customerReference") ?? ""),
        ...(form.get("dueAt")
          ? { dueAt: new Date(`${form.get("dueAt")}T23:59:59`).toISOString() }
          : {}),
        idempotencyKey,
      };
      let order: DashboardOrder;
      if (demo) {
        if (demoOrders().some((o) => o.reference === body.reference))
          throw new Error("This order reference already exists.");
        order = {
          ...body,
          amount: normalizeUsdcAmount(body.amount),
          id: crypto.randomUUID(),
          merchantName: demoWorkspace.name,
          recipient: demoWorkspace.recipient,
          chainId: demoWorkspace.chainId,
          createdAt: new Date().toISOString(),
          status: "pending",
        };
        saveDemoOrders([order, ...demoOrders()]);
      } else
        order = (await call<{ order: DashboardOrder }>("orders", body)).order;
      setRetryKey("");
      formElement.reset();
      setShowForm(false);
      setNotice(
        `Payment link created for ${order.reference}. Use “Open checkout” to view or share it.`,
      );
      await refresh();
    });
  }
  function checkoutUrl(order: DashboardOrder) {
    return demo ? `/checkout/demo?order=${order.id}` : `/checkout/${order.id}`;
  }
  const visible = orders.filter(
    (o) =>
      (filter === "all" ||
        (filter === "overdue"
          ? o.status === "pending" && o.dueAt && Date.parse(o.dueAt) < asOf
          : o.status === filter)) &&
      `${o.reference} ${o.title} ${o.customerReference}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const statusName = (o: DashboardOrder) =>
    o.status === "pending" && o.dueAt && Date.parse(o.dueAt) < asOf
      ? "Overdue"
      : o.status[0].toUpperCase() + o.status.slice(1);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href={demo ? "/business/demo" : "/business"}
        >
          <b>A</b>Arc PayLink
        </Link>
        <nav className={styles.nav}>
          <Link href="/">PayLink home</Link>
          {!demo && <Link href="/business/demo">Try sandbox</Link>}
          <span className={styles.badge}>
            {demo ? "SANDBOX" : ARC_NETWORK_NAME}
          </span>
        </nav>
      </header>
      {demo && (
        <div className={styles.demo}>
          <strong>Interactive sandbox.</strong> Sample business, local browser
          data and simulated payments. No real funds, Google sign-in or
          blockchain transactions.{" "}
          <Link href="/business">Open real workspace →</Link>
        </div>
      )}
      <div className={styles.content}>
        {error && (
          <div className={styles.alert} role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <p className={styles.muted}>Loading your business…</p>
        ) : !workspace ? (
          <div className={styles.onboard}>
            <section>
              <p className={styles.eyebrow}>Collections for people & agents</p>
              <h1>
                A payment link.
                <br />A clear business record.
              </h1>
              <p className={styles.muted}>
                Let customers pay with Google and an embedded USDC account. Give
                your team and its agent one place to follow every purchase.
              </p>
              <ul className={styles.features}>
                <li>
                  <em>01</em>
                  <div>
                    <b>Create and share</b>
                    <span>One order, one exact amount, one payment link.</span>
                  </div>
                </li>
                <li>
                  <em>02</em>
                  <div>
                    <b>No wallet extension</b>
                    <span>Customers sign in and approve with Circle.</span>
                  </div>
                </li>
                <li>
                  <em>03</em>
                  <div>
                    <b>Track with your agent</b>
                    <span>
                      Scoped access to collections and verified receipts.
                    </span>
                  </div>
                </li>
              </ul>
              <Link className={styles.secondary} href="/business/demo">
                Explore the interactive sandbox →
              </Link>
            </section>
            <section className={styles.card}>
              <p className={styles.eyebrow}>Business workspace</p>
              <h2>{login ? "Welcome back" : "Start collecting"}</h2>
              <p className={styles.muted}>
                {login
                  ? "Use the owner recovery key you saved when creating your workspace."
                  : "Choose your business name and the Arc address that receives customer payments."}
              </p>
              <div className={styles.divider} />
              <form className={styles.form} onSubmit={onboarding}>
                {login ? (
                  <label>
                    Owner recovery key
                    <input
                      name="token"
                      type="password"
                      autoComplete="off"
                      required
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      Business name
                      <input
                        name="name"
                        placeholder="Your studio or company"
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      Receiving Arc address
                      <input
                        name="recipient"
                        placeholder="0x…"
                        spellCheck={false}
                        required
                      />
                    </label>
                    <p className={styles.note}>
                      Payments go directly to this address. Verify it carefully;
                      the workspace receiving address is fixed.
                    </p>
                  </>
                )}
                <button
                  className={styles.button}
                  disabled={busy || !storageReady}
                >
                  {busy
                    ? "Working…"
                    : login
                      ? "Open workspace"
                      : "Create workspace →"}
                </button>
                {!storageReady && (
                  <p className={styles.alert}>
                    Business storage is unavailable on this deployment. You can
                    explore the sandbox.
                  </p>
                )}
              </form>
              <button className={styles.link} onClick={() => setLogin(!login)}>
                {login
                  ? "Create a new workspace"
                  : "Already have a recovery key? Sign in"}
              </button>
            </section>
          </div>
        ) : (
          <>
            <div className={styles.hero}>
              <div>
                <p className={styles.eyebrow}>{workspace.name}</p>
                <h1>Your collections, in view.</h1>
                <p className={styles.muted}>
                  Customer purchases, payment status and receipts — ready for
                  your team and its agent.
                </p>
              </div>
              <button
                className={styles.button}
                onClick={() => setShowForm(!showForm)}
              >
                {showForm ? "Close form" : "+ Create payment link"}
              </button>
            </div>
            {secret && (
              <div className={`${styles.card} ${styles.secret}`}>
                <h2>{secretKind} — save it now</h2>
                <p className={styles.muted}>
                  {secretKind.startsWith("Owner")
                    ? "This key restores your workspace on another device. It is only displayed now. Keep it private."
                    : "Give this read-only key to your business agent. It can read orders and receipts; it cannot move funds."}
                </p>
                <pre className={styles.code}>{secret}</pre>
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    onClick={() =>
                      download(
                        "arcpaylink-access-key.txt",
                        `${secretKind}\n${workspace.name}\n${secret}\n`,
                      )
                    }
                  >
                    Download key
                  </button>
                  <button
                    className={styles.secondary}
                    onClick={() => {
                      setSecret("");
                    }}
                  >
                    I saved it
                  </button>
                </div>
              </div>
            )}
            {notice && (
              <div className={styles.success} role="status">
                {notice}
              </div>
            )}
            {!embeddedReady && !demo && (
              <div className={styles.alert}>
                Embedded checkout is not configured on this preview. Orders and
                agent access work; Google payment activation still requires the
                deployment’s Circle configuration.
              </div>
            )}
            {showForm && (
              <section className={styles.card}>
                <h2>Create a customer payment link</h2>
                <form className={styles.form} onSubmit={createOrder}>
                  <div className={styles.row}>
                    <label>
                      Order / invoice reference
                      <input
                        name="reference"
                        placeholder="INV-1043"
                        maxLength={64}
                        required
                      />
                    </label>
                    <label>
                      What is the customer buying?
                      <input
                        name="title"
                        placeholder="Website delivery"
                        maxLength={80}
                        required
                      />
                    </label>
                  </div>
                  <div className={styles.row}>
                    <label>
                      USDC amount
                      <input
                        name="amount"
                        inputMode="decimal"
                        placeholder="250.00"
                        required
                      />
                    </label>
                    <label>
                      Due date (optional)
                      <input type="date" name="dueAt" />
                    </label>
                  </div>
                  <label>
                    Internal customer reference (optional)
                    <input
                      name="customerReference"
                      placeholder="ACME-042 · your business and authorized agents"
                      maxLength={100}
                    />
                  </label>
                  <p className={styles.note}>
                    Use a customer code instead of personal details. Your business
                    and its authorized read-only agents can read this reference.
                    You can clear this reference later while keeping the payment
                    record. Order records remain stored; automatic deletion and
                    full workspace deletion are not available in this pilot.
                  </p>
                  <p className={styles.note}>
                    Receiving address: {workspace.recipient}. The customer
                    cannot change the amount or destination.
                  </p>
                  <button className={styles.button} disabled={busy}>
                    {busy ? "Creating…" : "Create link →"}
                  </button>
                </form>
              </section>
            )}
            <div className={styles.stats}>
              {[
                [
                  "Collected",
                  summary?.paidUsdc ?? "0",
                  `${summary?.paidCount ?? 0} paid orders`,
                ],
                [
                  "Outstanding",
                  summary?.outstandingUsdc ?? "0",
                  "USDC awaiting payment",
                ],
                [
                  "Orders",
                  String(summary?.count ?? 0),
                  "Across this workspace",
                ],
                [
                  "Needs attention",
                  String((summary?.overdue ?? 0) + (summary?.processing ?? 0)),
                  `${summary?.overdue ?? 0} overdue · ${summary?.processing ?? 0} processing`,
                ],
              ].map(([label, value, sub]) => (
                <div className={styles.stat} key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{sub}</small>
                </div>
              ))}
            </div>
            <div className={styles.grid}>
              <section className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <h2>Customer orders</h2>
                    <p className={styles.muted}>
                      Refresh to load the latest orders and payment status.
                    </p>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void act(refresh)}
                    >
                      Refresh
                    </button>
                    <button
                      className={styles.secondary}
                      onClick={() =>
                        download(
                          "arcpaylink-orders.csv",
                          csv(orders),
                          "text/csv",
                        )
                      }
                    >
                      Export loaded orders
                    </button>
                  </div>
                </div>
                <div className={styles.filters}>
                  {[
                    "all",
                    "pending",
                    "processing",
                    "paid",
                    "overdue",
                    "cancelled",
                  ].map((f) => (
                    <button
                      className={styles.filter}
                      aria-pressed={filter === f}
                      key={f}
                      onClick={() => setFilter(f)}
                    >
                      {f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <input
                  className={styles.search}
                  aria-label="Search orders"
                  placeholder="Search by reference, customer or purchase…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Payment link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <b>{o.reference}</b>
                            <small>{o.customerReference || o.title}</small>
                          </td>
                          <td>{o.amount} USDC</td>
                          <td>
                            <span
                              className={styles.status}
                              data-status={o.status}
                            >
                              {statusName(o)}
                            </span>
                          </td>
                          <td>
                            <Link className={styles.link} href={checkoutUrl(o)}>
                              Open checkout ↗
                            </Link>
                            <button
                              className={styles.link}
                              onClick={() =>
                                void act(async () => {
                                  await navigator.clipboard.writeText(
                                    `${window.location.origin}${checkoutUrl(o)}`,
                                  );
                                  setNotice(
                                    `Payment link copied for ${o.reference}.`,
                                  );
                                })
                              }
                            >
                              Copy link
                            </button>
                            {o.customerReference && !demo && (
                              <button className={styles.link} disabled={busy}
                                onClick={() => {
                                  if (!window.confirm("Clear this internal customer reference? This cannot be undone. The order and payment receipt remain. Previously exported or agent-saved copies are not removed.")) return;
                                  void act(async () => {
                                    await call(`orders/${o.id}/clear-customer-reference`, {});
                                    setNotice("Customer reference cleared. Order and payment receipt preserved.");
                                    await refresh();
                                  });
                                }}>
                                Clear customer reference
                              </button>
                            )}
                            {o.receipt && !demo && (
                              <a
                                className={styles.link}
                                target="_blank"
                                rel="noreferrer"
                                href={`${ARC_EXPLORER_URL}/tx/${o.receipt.transactionHash}`}
                              >
                                Receipt ↗
                              </a>
                            )}
                            {o.status === "pending" && (
                              <button
                                className={styles.link}
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    if (demo)
                                      saveDemoOrders(
                                        demoOrders().map((x) =>
                                          x.id === o.id
                                            ? { ...x, status: "cancelled" }
                                            : x,
                                        ),
                                      );
                                    else
                                      await call(`orders/${o.id}/cancel`, {});
                                    await refresh();
                                  })
                                }
                              >
                                Cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!visible.length && (
                  <p className={styles.empty}>
                    {orders.length
                      ? "No orders match this view."
                      : "Your first payment link starts here. Create an order to see its collection status."}
                  </p>
                )}
                {cursor && (
                  <button
                    className={styles.secondary}
                    onClick={() =>
                      void act(async () => {
                        const page = await call<{
                          orders: DashboardOrder[];
                          cursor?: string;
                        }>(`orders?cursor=${encodeURIComponent(cursor)}`);
                        setOrders((current) => [
                          ...current,
                          ...page.orders.filter(
                            (o) => !current.some((c) => c.id === o.id),
                          ),
                        ]);
                        setCursor(page.cursor);
                      })
                    }
                  >
                    Load more orders
                  </button>
                )}
              </section>
              <aside className={styles.stack}>
                <CollectionsMonitorStatus
                  key={workspace.id}
                  demo={demo}
                  workspaceName={workspace.name}
                  workspaceId={workspace.id}
                  disabled={busy}
                  onBusyChange={setMonitorBusy}
                  onRefresh={refresh}
                />
                <section className={styles.card}>
                  <p className={styles.eyebrow}>Agent access</p>
                  <h2>Your agent can follow along.</h2>
                  <p className={styles.muted}>
                    Ask which customers paid, what is overdue and where the
                    receipts are.
                  </p>
                  <div className={styles.steps}>
                    <div className={styles.step}>
                      <i>1</i>
                      <span>Create a read-only access key.</span>
                    </div>
                    <div className={styles.step}>
                      <i>2</i>
                      <span>
                        Connect your agent using the MCP endpoint below.
                      </span>
                    </div>
                    <div className={styles.step}>
                      <i>3</i>
                      <span>
                        Ask for a collections report or schedule checks in your
                        agent.
                      </span>
                    </div>
                  </div>
                  <button
                    className={styles.button}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        if (demo) {
                          setAgentResult(
                            JSON.stringify(
                              {
                                tool: "get_receivables_summary",
                                mode: "SIMULATED",
                                result: summary,
                              },
                              null,
                              2,
                            ),
                          );
                          return;
                        }
                        const result = await call<{ token: string }>("keys", {
                          name: "Collections agent",
                        });
                        setSecret(result.token);
                        setSecretKind("Read-only agent key");
                        await refresh();
                      })
                    }
                  >
                    {demo ? "Preview agent report" : "Create agent key"}
                  </button>
                  <pre className={styles.code}>
                    POST /api/business/mcp{`\n`}Authorization: Bearer
                    YOUR_AGENT_KEY
                  </pre>
                  <p className={styles.note}>
                    Agent access is read-only. Connecting an agent does not
                    start a background schedule automatically.
                  </p>
                  {keys
                    .filter((k) => k.role === "reader")
                    .map((k) => (
                      <div key={k.id} className={styles.key}>
                        <span>
                          {k.name}
                          <br />
                          <small>
                            {k.revokedAt ? "Revoked" : "Active"} ·{" "}
                            {k.id.slice(0, 8)}
                          </small>
                        </span>
                        {!k.revokedAt && (
                          <button
                            className={styles.link}
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await call(`keys/${k.id}/revoke`, {});
                                await refresh();
                              })
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  {agentResult && (
                    <pre className={styles.code}>{agentResult}</pre>
                  )}
                </section>
                {!demo && (
                  <section className={styles.card}>
                    <h3>Owner access</h3>
                    <p className={styles.muted}>
                      Your recovery key restores this workspace in another browser.
                      Save the replacement before activating it. Activation signs
                      out browsers using the old key; orders and agent keys remain available.
                    </p>
                    <button className={styles.link} disabled={busy}
                      onClick={() => void act(async () => {
                        const next = await call<{ token: string; expiresAt: string }>("owner-key/prepare", {});
                        setReplacement(next);
                        setReplacementSaved(false);
                      })}>
                      Prepare replacement key
                    </button>
                    {replacement && (
                      <>
                        <p className={styles.muted}>
                          Your current key still works. Activate this replacement
                          before {new Date(replacement.expiresAt).toLocaleString()}.
                          Keep it private.
                        </p>
                        <pre className={styles.code}>{replacement.token}</pre>
                        <button className={styles.link} disabled={busy}
                          onClick={() => download("arcpaylink-owner-recovery.txt", replacement.token)}>
                          Download replacement key
                        </button>
                        <label>
                          <input type="checkbox" checked={replacementSaved}
                            onChange={(event) => setReplacementSaved(event.target.checked)} />
                          I saved the replacement key securely
                        </label>
                        <button className={styles.link} disabled={busy || !replacementSaved}
                          onClick={() => void act(async () => {
                            await call("owner-key/activate", { token: replacement.token });
                            setReplacement(undefined);
                            setReplacementSaved(false);
                            setSecret("");
                            setNotice("Owner key renewed. Use your saved replacement to recover this workspace. The old key no longer works.");
                            await refresh();
                          })}>
                          Activate replacement key
                        </button>
                      </>
                    )}
                  </section>
                )}
                <section className={styles.card}>
                  <h3>Direct to your business</h3>
                  <p className={styles.muted}>
                    Payments settle to your receiving address. “Paid” is
                    recorded after the Arc USDC transfer is verified.
                  </p>
                  <pre className={styles.code}>{workspace.recipient}</pre>
                  {!demo && (
                    <button
                      className={styles.link}
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await fetch("/api/business/session", {
                            method: "DELETE",
                          });
                          setSecret("");
                          setReplacement(undefined);
                          setReplacementSaved(false);
                          setWorkspace(undefined);
                        })
                      }
                    >
                      Sign out of workspace
                    </button>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
      <footer className={styles.footer}>
        <span>Arc PayLink · Business collections</span>
        <span>
          {demo
            ? "Simulated data · No real funds"
            : "USDC payments · User-controlled customer accounts"}
        </span>
      </footer>
    </div>
  );
}
