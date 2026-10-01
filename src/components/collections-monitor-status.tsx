"use client";

import { useEffect, useState } from "react";
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

export function CollectionsMonitorStatus({
  demo = false,
}: {
  demo?: boolean;
}) {
  const [status, setStatus] = useState<MonitorStatus>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (demo) return;
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
    const interval = window.setInterval(() => void refresh(), 30000);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [demo]);

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
