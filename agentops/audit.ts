import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { parseUsdcAmount } from "../src/lib/amount";

export type AuditEvent = {
  schemaVersion: 1;
  sequence: number;
  previousHash: string;
  event: "decision" | "payment_started" | "payment_submitted" | "payment_failed" | "payment_verified" | "settlement_synced" | "settlement_sync_failed";
  at: string;
  requestId: string;
  invoiceId: string;
  amount: string;
  recipient: string;
  details: Record<string, string | number | boolean | null>;
  hash: string;
};
type NewEvent = Omit<AuditEvent, "schemaVersion" | "sequence" | "previousHash" | "hash">;
const GENESIS = "0".repeat(64);
const normalizeId = (id: string) => id.trim().toLowerCase();
const hashEvent = (event: Omit<AuditEvent, "hash">) => createHash("sha256").update(JSON.stringify(event)).digest("hex");

export class AuditSession {
  constructor(readonly rows: AuditEvent[], private readonly path: string) {}

  hasAttempt(requestId: string, invoiceId: string, obligationId: string): boolean {
    return this.rows.some((row) => row.event === "payment_started" && (
      normalizeId(row.requestId) === normalizeId(requestId)
      || normalizeId(row.invoiceId) === normalizeId(invoiceId)
      || (typeof row.details.obligationId === "string" && normalizeId(row.details.obligationId) === normalizeId(obligationId))
    ));
  }

  reservedSince(start: Date): bigint {
    return this.rows.filter((row) => row.event === "payment_started").reduce((total, attempt) => {
      const verified = this.rows.find((row) => row.event === "payment_verified" && row.requestId === attempt.requestId);
      // Unresolved attempts reserve budget across midnight: timeout does not mean no payment.
      if (Date.parse(attempt.at) >= start.getTime() || !verified || Date.parse(verified.at) >= start.getTime()) {
        return total + parseUsdcAmount(attempt.amount);
      }
      return total;
    }, 0n);
  }

  async append(input: NewEvent): Promise<AuditEvent> {
    const body = { schemaVersion: 1 as const, sequence: this.rows.length + 1, previousHash: this.rows.at(-1)?.hash ?? GENESIS, ...input };
    const record = { ...body, hash: hashEvent(body) };
    const file = await open(this.path, "a", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await file.sync();
    } finally { await file.close(); }
    this.rows.push(record);
    return record;
  }
}

export class AuditLedger {
  constructor(private readonly path: string) {}

  async exclusive<T>(operation: (session: AuditSession) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    let lock;
    try { lock = await open(`${this.path}.lock`, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("AgentOps ledger is busy or a previous process stopped unexpectedly. No payment was submitted by this call.");
      throw error;
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      return await operation(new AuditSession(await this.readUnlocked(), this.path));
    } finally {
      await lock.close();
      await unlink(`${this.path}.lock`);
    }
  }

  private async readUnlocked(): Promise<AuditEvent[]> {
    let raw: string;
    try { raw = await readFile(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const rows = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as AuditEvent);
    let previousHash = GENESIS;
    rows.forEach((row, index) => {
      const { hash, ...body } = row;
      if (row.schemaVersion !== 1 || row.sequence !== index + 1 || row.previousHash !== previousHash || hashEvent(body) !== hash) {
        throw new Error(`Agent audit ledger integrity check failed at entry ${index + 1}.`);
      }
      previousHash = hash;
    });
    return rows;
  }

  read(): Promise<AuditEvent[]> { return this.exclusive(async (session) => session.rows); }
  append(input: NewEvent): Promise<AuditEvent> { return this.exclusive((session) => session.append(input)); }
  hasInvoice(invoiceId: string): Promise<boolean> {
    return this.exclusive(async (session) => session.rows.some((row) => row.event === "payment_started" && normalizeId(row.invoiceId) === normalizeId(invoiceId)));
  }
  spentSince(start: Date): Promise<bigint> { return this.exclusive(async (session) => session.reservedSince(start)); }
}
