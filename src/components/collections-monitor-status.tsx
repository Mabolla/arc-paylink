"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./collections-monitor-status.module.css";

type MonitorStatus = {
  monitor?: {
    lastCompletedAt?: string;
    lastStartedAt?: string;
    summaryAsOf?: string;
    outcome: "never" | "complete" | "partial" | "busy" | "failed";
    trackedReceipts: number;
    paidUsdc?: string;
    outstandingUsdc?: string;
    chainId: number;
  } | null;
  schedulingConfigured: boolean;
};

const sample: MonitorStatus = {
  schedulingConfigured: false,
  monitor: {
    lastCompletedAt: "2026-10-01T18:30:00.000Z",
    summaryAsOf: "2026-10-01T18:30:00.000Z",
    outcome: "complete",
    trackedReceipts: 2,
    paidUsdc: "48",
    outstandingUsdc: "25",
    chainId: 5042,
  },
};

function reportTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

const keyIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class RequestFailure extends Error {
  constructor(readonly status: number) {
    super("Unable to finish the report check.");
  }
}

type CheckTask = {
  name: string;
  id?: string;
  leaving: boolean;
  exitCleanup?: Promise<boolean>;
};

async function revokeKnownCheckKey(id: string) {
  const response = await fetch(`/api/business/keys/${id}/revoke`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    keepalive: true,
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Unable to revoke the check key.");
}

function requestExitCleanup(task: CheckTask) {
  if (!task.id || task.exitCleanup) return;
  // pagehide and unmount share one best-effort request. Only the key created by
  // this action is eligible; no existing reader or private token is retrieved.
  task.exitCleanup = revokeKnownCheckKey(task.id).then(
    () => true,
    () => false,
  );
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/business/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(65000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new RequestFailure(response.status);
  return response.json();
}

async function revokeCheckKey(name: string, knownId?: string) {
  const ids = new Set<string>(knownId ? [knownId] : []);
  try {
    const response = await fetch("/api/business/keys", {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Unable to read check keys.");
    const value: {
      keys: { id: string; name: string; role: string; revokedAt?: string }[];
    } = await response.json();
    if (!Array.isArray(value.keys)) throw new Error("Invalid key list.");
    for (const key of value.keys) {
      if (
        key.name === name &&
        key.role === "reader" &&
        !key.revokedAt &&
        keyIdPattern.test(key.id)
      ) ids.add(key.id);
    }
  } catch {
    // A known ID still allows cleanup if the key list is temporarily unavailable.
    if (!knownId) throw new Error("Unable to revoke the check key.");
  }
  for (const id of ids) await revokeKnownCheckKey(id);
}

export function CollectionsMonitorStatus({
  demo = false,
  workspaceName,
  workspaceId,
  disabled = false,
  onBusyChange,
  onRefresh,
}: {
  demo?: boolean;
  workspaceName?: string;
  workspaceId?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<MonitorStatus>();
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const [checkError, setCheckError] = useState("");
  const [cleanup, setCleanup] = useState<{ name: string; id?: string }>();
  const actionPending = useRef(false);
  const mounted = useRef(true);
  const pageLeaving = useRef(false);
  const checkTask = useRef<CheckTask | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    pageLeaving.current = false;
    if (demo)
      return () => {
        mounted.current = false;
      };
    let active = true;
    let pending = false;
    let controller: AbortController | undefined;

    const refresh = async () => {
      if (!active || document.hidden || pending) return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/business/monitor", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Status unavailable.");
        const result: MonitorStatus = await response.json();
        if (typeof result?.schedulingConfigured !== "boolean")
          throw new Error("Status unavailable.");
        if (active) {
          setStatus(result);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
      }
    };

    queueMicrotask(() => void refresh());
    const onPageHide = () => {
      pageLeaving.current = true;
      const task = checkTask.current;
      if (task) {
        task.leaving = true;
        requestExitCleanup(task);
      }
    };
    const onPageShow = () => { pageLeaving.current = false; };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      active = false;
      mounted.current = false;
      onPageHide();
      controller?.abort();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [demo]);

  async function reloadStatus() {
    try {
      const response = await fetch("/api/business/monitor", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Status unavailable.");
      const result: MonitorStatus = await response.json();
      if (typeof result?.schedulingConfigured !== "boolean")
        throw new Error("Status unavailable.");
      if (mounted.current) {
        setStatus(result);
        setError(false);
      }
    } catch {
      if (mounted.current) setError(true);
    }
  }

  async function finishAction() {
    try {
      await reloadStatus();
    } finally {
      actionPending.current = false;
      if (mounted.current) setChecking(false);
      onBusyChange?.(false);
    }
    // Updating the rest of the dashboard must not keep the check locked after
    // cleanup. Its separate refresh can fail without extending this action.
    void Promise.resolve().then(() => onRefresh?.()).catch(() => {
      if (mounted.current)
        setCheckError("The workspace could not refresh. Reload to see the latest records.");
    });
  }

  async function checkNow() {
    if (demo || disabled || cleanup || actionPending.current || pageLeaving.current) return;
    actionPending.current = true;
    setChecking(true);
    setNotice("");
    setCheckError("");
    onBusyChange?.(true);
    const name = `Report check ${crypto.randomUUID()}`;
    const task: CheckTask = { name, leaving: false };
    checkTask.current = task;
    let id: string | undefined;
    let needsCleanup = true;
    try {
      const issued = await post<{
        token: string;
        key: { id: string; role: string };
      }>("keys", { name });
      if (issued.key?.role === "reader" && keyIdPattern.test(issued.key.id))
        id = issued.key.id;
      task.id = id;
      if (task.leaving || !mounted.current) {
        requestExitCleanup(task);
        throw new Error("The check was interrupted.");
      }
      if (
        !id ||
        typeof issued.token !== "string" ||
        !/^apm_[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(issued.token) ||
        issued.token.split(".")[1] !== id ||
        (workspaceId && !issued.token.startsWith(`apm_${workspaceId}.`))
      )
        throw new Error("Unable to use the check key.");
      // The owner explicitly creates this scoped key for one check. It is never
      // retained in component state, browser storage, a URL or a log.
      const result = await post<{ outcome: "complete" | "partial" | "busy" }>(
        "monitor/refresh", { readerToken: issued.token },
      );
      if (!["complete", "partial", "busy"].includes(result.outcome))
        throw new Error("Unable to finish the check.");
      if (mounted.current) setNotice(
        result.outcome === "complete"
          ? "Report refreshed."
          : result.outcome === "partial"
            ? "Part of the report updated. Check again to continue."
            : "Another check is running. Try again shortly.",
      );
    } catch (failure) {
      // An explicit rejection before key creation needs no cleanup. Ambiguous
      // network/server failures still look up the unique name to revoke it.
      if (!id && failure instanceof RequestFailure && failure.status < 500)
        needsCleanup = false;
      if (mounted.current) setCheckError("The check could not finish. The last completed report remains available.");
    } finally {
      let cleaned = !needsCleanup;
      if (needsCleanup) {
        try {
          if (id) {
            requestExitCleanup(task);
            if (!(await task.exitCleanup))
              throw new Error("Unable to revoke the check key.");
          } else {
            await revokeCheckKey(name);
          }
          cleaned = true;
        }
        catch {
          if (mounted.current) setCleanup({ name, id });
        }
      }
      if (cleaned && checkTask.current === task) checkTask.current = undefined;
      await finishAction();
    }
  }

  async function retryCleanup() {
    if (demo || disabled || !cleanup || actionPending.current) return;
    actionPending.current = true;
    setChecking(true);
    setCheckError("");
    onBusyChange?.(true);
    try {
      await revokeCheckKey(cleanup.name, cleanup.id);
      if (checkTask.current?.name === cleanup.name) checkTask.current = undefined;
      if (mounted.current) {
        setCleanup(undefined);
        setNotice("Check key revoked.");
      }
    } catch {
      if (mounted.current) setCheckError("Check key revocation could not be confirmed. Retry or check Agent access.");
    } finally {
      await finishAction();
    }
  }

  const current = demo ? sample : status;
  const monitor = current?.monitor;
  const outcome = monitor?.outcome ?? "never";
  const label =
    outcome === "busy"
      ? "Report in progress"
      : outcome === "failed"
        ? "Last check failed"
        : outcome === "partial"
          ? "Partial report"
          : outcome === "complete"
            ? "Report recorded"
            : "Not yet run";

  return (
    <section className={styles.card} aria-labelledby="collections-monitor-title">
      <div className={styles.header}>
        <h2 id="collections-monitor-title">Background reporting</h2>
        <span
          className={styles.badge}
          data-outcome={demo ? "sample" : outcome}
          aria-live="polite"
        >
          {demo
            ? "Simulated example"
            : error
              ? "Status unavailable"
              : current
                ? label
                : "Checking status"}
        </span>
      </div>

      {demo && (
        <p className={styles.sample}>
          Sample report only. No background service runs in this demo.
        </p>
      )}
      <div className={styles.check}>
        <p className={styles.note} id="collections-monitor-check-help">
          {demo
            ? "Check now is available in your real business workspace."
            : <>Check {workspaceName ? <strong>{workspaceName}</strong> : "this business"} now. Creates a read-only key and attempts to revoke it when finished or when you leave. If interrupted, check Agent access and revoke any remaining check key. This reads recorded orders and receipts.</>}
        </p>
        <button
          type="button"
          className={styles.button}
          disabled={demo || disabled || checking || !!cleanup}
          aria-describedby="collections-monitor-check-help"
          aria-busy={checking}
          onClick={() => void checkNow()}
        >
          {checking ? "Checking…" : "Check now"}
        </button>
        <button type="button" className={styles.button}
          disabled={demo || disabled || checking}
          onClick={() => void reloadStatus()}>
          Refresh saved report
        </button>
      </div>
      <p className={styles.note}>Report loads when opened. Refresh to see later updates.</p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {checkError && <p className={styles.error} role="alert">{checkError}</p>}
      {cleanup && (
        <div className={styles.cleanup} role="alert">
          <p>Revocation could not be confirmed for the read-only key “{cleanup.name}”. Retry here or check Agent access.</p>
          <button
            type="button"
            className={styles.button}
            disabled={disabled || checking}
            onClick={() => void retryCleanup()}
          >
            {checking ? "Revoking…" : "Revoke check key"}
          </button>
        </div>
      )}
      {error && !demo && (
        <p className={styles.error} role="status">
          Background reporting status is unavailable.
        </p>
      )}
      {current ? (
        <>
          {outcome === "never" && (
            <p className={styles.note}>No background report recorded yet.</p>
          )}
          {outcome === "partial" && (
            <p className={styles.note}>Some checks did not complete.</p>
          )}
          {outcome === "failed" && (
            <p className={styles.error}>
              {monitor?.lastCompletedAt
                ? "The last check failed. The previous completed report is retained."
                : "The last check failed. No completed report is available yet."}
            </p>
          )}
          <p className={styles.note}>
            {current.schedulingConfigured
              ? "Automatic checks are configured. A completed report confirms a server check ran."
              : "Automatic checks are not active."}
            {!demo && !current.schedulingConfigured && outcome === "complete" &&
              " This report came from a server check."}
          </p>
          {monitor && outcome !== "never" && (
            <>
              {monitor.summaryAsOf && (
                <p className={styles.note}>
                  Collected and outstanding totals reflect the scan recorded
                  below.
                </p>
              )}
              <dl className={styles.details}>
                {monitor.summaryAsOf && (
                  <div>
                    <dt>Report as of</dt>
                    <dd>
                      <time dateTime={monitor.summaryAsOf}>
                        {reportTime(monitor.summaryAsOf)}
                      </time>
                    </dd>
                  </div>
                )}
                {monitor.lastCompletedAt && (
                  <div>
                    <dt>Last completed</dt>
                    <dd>
                      <time dateTime={monitor.lastCompletedAt}>
                        {reportTime(monitor.lastCompletedAt)}
                      </time>
                    </dd>
                  </div>
                )}
                {outcome === "busy" && monitor.lastStartedAt && (
                  <div>
                    <dt>Started</dt>
                    <dd>
                      <time dateTime={monitor.lastStartedAt}>
                        {reportTime(monitor.lastStartedAt)}
                      </time>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Receipts tracked</dt>
                  <dd>{monitor.trackedReceipts}</dd>
                </div>
                {monitor.paidUsdc !== undefined && (
                  <div>
                    <dt>Collected</dt>
                    <dd>{monitor.paidUsdc} USDC</dd>
                  </div>
                )}
                {monitor.outstandingUsdc !== undefined && (
                  <div>
                    <dt>Outstanding</dt>
                    <dd>{monitor.outstandingUsdc} USDC</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </>
      ) : (
        !error && <p className={styles.note}>Loading the latest report…</p>
      )}
    </section>
  );
}
