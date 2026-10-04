import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getAddress, isAddress, formatUnits } from "viem";
import { z } from "zod";
import { ARC_CHAIN_ID } from "../arc";
import { normalizeUsdcAmount, parseUsdcAmount } from "../amount";
import { CommerceError, type CommerceStore } from "./store";
import {
  publicOrder,
  type AccessKey,
  type Order,
  type Principal,
  type Workspace,
} from "./types";

export const uuid = z.string().uuid();
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\x00-\x1f]/.test(s));
export const OrderInput = z
  .object({
    reference: text(64),
    title: text(80),
    amount: text(32),
    customerReference: z.string().trim().max(100).default(""),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    idempotencyKey: uuid,
  })
  .strict();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const orderPath = (merchantId: string, id: string) =>
  `merchants/${uuid.parse(merchantId)}/orders/${uuid.parse(id)}.json`;
const keyPath = (merchantId: string, id: string) =>
  `merchants/${uuid.parse(merchantId)}/keys/${uuid.parse(id)}.json`;

export class CommerceService {
  constructor(
    public store: CommerceStore,
    public now = () => new Date().toISOString(),
  ) {}

  async createWorkspace(input: unknown) {
    const data = z
      .object({
        name: text(80),
        recipient: z.string().refine((a) => isAddress(a, { strict: false })),
      })
      .strict()
      .parse(input);
    if (/^0x0{40}$/i.test(data.recipient))
      throw new CommerceError("Enter a receiving address that you control.");
    const workspace: Workspace = {
      id: randomUUID(),
      name: data.name,
      recipient: getAddress(data.recipient),
      chainId: ARC_CHAIN_ID,
      createdAt: this.now(),
    };
    await this.store.write(
      `merchants/${workspace.id}/workspace.json`,
      workspace,
    );
    const credential = await this.newKey(
      workspace.id,
      "owner",
      "Workspace owner",
    );
    return { workspace, ...credential };
  }

  private async newKey(
    merchantId: string,
    role: AccessKey["role"],
    name: string,
  ) {
    const id = randomUUID();
    const token = `apm_${merchantId}.${id}.${randomBytes(32).toString("base64url")}`;
    const key: AccessKey = {
      id,
      merchantId,
      role,
      name,
      hash: digest(token),
      createdAt: this.now(),
    };
    await this.store.write(keyPath(merchantId, id), key);
    return { token, key: { id, role, name, createdAt: key.createdAt } };
  }

  async authorize(token: string | undefined): Promise<Principal> {
    const match = token?.match(
      /^apm_([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/,
    );
    if (
      !match ||
      !uuid.safeParse(match[1]).success ||
      !uuid.safeParse(match[2]).success
    )
      throw new CommerceError("Sign in with your business access key.", 401);
    const saved = await this.store.read<AccessKey>(keyPath(match[1], match[2]));
    if (
      !saved ||
      saved.value.revokedAt ||
      !timingSafeEqual(
        Buffer.from(saved.value.hash, "hex"),
        Buffer.from(digest(token!), "hex"),
      )
    )
      throw new CommerceError("Access key is invalid or revoked.", 401);
    const workspace = await this.store.read<Workspace>(
      `merchants/${match[1]}/workspace.json`,
    );
    if (!workspace || workspace.value.chainId !== ARC_CHAIN_ID)
      throw new CommerceError("Workspace unavailable.", 401);
    return { workspace: workspace.value, key: saved.value };
  }

  owner(p: Principal) {
    if (p.key.role !== "owner")
      throw new CommerceError("This agent key has read-only access.", 403);
  }
  async issueReader(p: Principal, name: unknown) {
    this.owner(p);
    return this.newKey(p.workspace.id, "reader", text(60).parse(name));
  }
  async prepareOwnerRotation(p: Principal) {
    this.owner(p);
    const path = keyPath(p.workspace.id, p.key.id);
    const saved = await this.store.read<AccessKey>(path);
    if (!saved || saved.value.revokedAt || saved.value.hash !== p.key.hash)
      throw new CommerceError("Sign in again before renewing your key.", 401);
    const token = `apm_${p.workspace.id}.${p.key.id}.${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.parse(this.now()) + 30 * 60_000).toISOString();
    // One conditional update: the active credential remains valid until activation.
    await this.store.write(path, {
      ...saved.value,
      pendingOwnerHash: digest(token),
      pendingOwnerExpiresAt: expiresAt,
    }, saved.version);
    return { token, expiresAt };
  }

  async activateOwnerRotation(token: string) {
    const match = token.match(/^apm_([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/);
    if (!match || !uuid.safeParse(match[1]).success || !uuid.safeParse(match[2]).success)
      throw new CommerceError("Invalid replacement key.", 401);
    const path = keyPath(match[1], match[2]);
    const saved = await this.store.read<AccessKey>(path);
    if (!saved || saved.value.role !== "owner" || saved.value.revokedAt)
      throw new CommerceError("Invalid replacement key.", 401);
    const hash = digest(token);
    // A response may be lost after the commit. Repeating activation is safe.
    if (saved.value.hash === hash && saved.value.rotatedAt)
      return this.authorize(token);
    if (!saved.value.pendingOwnerHash ||
        !timingSafeEqual(Buffer.from(saved.value.pendingOwnerHash, "hex"), Buffer.from(hash, "hex")) ||
        !saved.value.pendingOwnerExpiresAt ||
        Date.parse(saved.value.pendingOwnerExpiresAt) <= Date.parse(this.now()))
      throw new CommerceError("Replacement key expired or superseded. Prepare a new key with your current owner key.", 401);
    const workspace = await this.store.read<Workspace>(`merchants/${match[1]}/workspace.json`);
    if (!workspace || workspace.value.chainId !== ARC_CHAIN_ID)
      throw new CommerceError("Workspace unavailable.", 401);
    const key = { ...saved.value, hash, rotatedAt: this.now() };
    delete key.pendingOwnerHash;
    delete key.pendingOwnerExpiresAt;
    // Atomic replacement invalidates the old key and its sessions at the same time.
    await this.store.write(path, key, saved.version);
    return { workspace: workspace.value, key };
  }
  async keys(p: Principal) {
    this.owner(p);
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.store.list(
        `merchants/${p.workspace.id}/keys/`,
        cursor,
      );
      paths.push(...page.paths);
      cursor = page.cursor;
    } while (cursor);
    return Promise.all(
      paths.map(async (path) => {
        const k = (await this.store.read<AccessKey>(path))!.value;
        return {
          id: k.id,
          role: k.role,
          name: k.name,
          createdAt: k.createdAt,
          revokedAt: k.revokedAt,
        };
      }),
    );
  }
  async revokeKey(p: Principal, id: string) {
    this.owner(p);
    const path = keyPath(p.workspace.id, id);
    const saved = await this.store.read<AccessKey>(path);
    if (!saved || saved.value.role !== "reader")
      throw new CommerceError("Agent key not found.", 404);
    if (!saved.value.revokedAt)
      await this.store.write(
        path,
        { ...saved.value, revokedAt: this.now() },
        saved.version,
      );
  }

  async createOrder(p: Principal, input: unknown) {
    this.owner(p);
    const data = OrderInput.parse(input);
    const amount = normalizeUsdcAmount(data.amount);
    const fingerprint = digest(JSON.stringify({ ...data, amount }));
    // A stable UUID makes retries repair the same record, never duplicate an invoice.
    const hex = digest(`${p.workspace.id}:${data.idempotencyKey}`);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const path = orderPath(p.workspace.id, id);
    let saved = await this.store.read<Order>(path);
    if (saved && saved.value.fingerprint !== fingerprint)
      throw new CommerceError(
        "This retry key was already used with different order details.",
        409,
      );
    const order: Order = {
      id,
      merchantId: p.workspace.id,
      merchantName: p.workspace.name,
      reference: data.reference,
      title: data.title,
      amount,
      recipient: p.workspace.recipient,
      chainId: ARC_CHAIN_ID,
      createdAt: this.now(),
      customerReference: data.customerReference,
      dueAt: data.dueAt,
      fingerprint,
      status: "pending",
    };
    // Reserve the merchant's business reference, including across different retry keys.
    const refPath = `merchants/${p.workspace.id}/references/${digest(data.reference)}.json`;
    const reserved = await this.store.read<{ id: string }>(refPath);
    if (reserved?.value.id !== undefined && reserved.value.id !== id)
      throw new CommerceError(
        "This order reference already exists. Open the existing order.",
        409,
      );
    if (!reserved) {
      try {
        await this.store.write(refPath, { id });
      } catch (e) {
        if ((await this.store.read<{ id: string }>(refPath))?.value.id !== id)
          throw e;
      }
    }
    if (!saved) {
      try {
        await this.store.write(path, order);
      } catch (e) {
        saved = await this.store.read<Order>(path);
        if (!saved) throw e;
      }
      saved ??= await this.store.read<Order>(path);
    }
    if (!saved || saved.value.fingerprint !== fingerprint)
      throw new CommerceError(
        "This retry key was already used with different order details.",
        409,
      );
    const pointer = `checkouts/${id}.json`;
    if (!(await this.store.read(pointer))) {
      try {
        await this.store.write(pointer, { merchantId: p.workspace.id });
      } catch (e) {
        if (!(await this.store.read(pointer))) throw e;
      }
    }
    return saved.value;
  }

  async order(p: Principal, id: string) {
    const saved = await this.store.read<Order>(orderPath(p.workspace.id, id));
    if (!saved) throw new CommerceError("Order not found.", 404);
    return saved.value;
  }
  async checkout(id: string) {
    uuid.parse(id);
    const pointer = await this.store.read<{ merchantId: string }>(
      `checkouts/${id}.json`,
    );
    if (!pointer) throw new CommerceError("Payment link not found.", 404);
    const saved = await this.store.read<Order>(
      orderPath(pointer.value.merchantId, id),
    );
    if (!saved) throw new CommerceError("Payment link not found.", 404);
    return saved;
  }
  async listOrders(p: Principal, cursor?: string) {
    const page = await this.store.list(
      `merchants/${p.workspace.id}/orders/`,
      cursor,
    );
    const orders = (
      await Promise.all(page.paths.map((path) => this.store.read<Order>(path)))
    )
      .filter((v) => v !== undefined)
      .map((v) => v.value)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { orders, cursor: page.cursor };
  }
  async cancel(p: Principal, id: string) {
    this.owner(p);
    const path = orderPath(p.workspace.id, id);
    const saved = await this.store.read<Order>(path);
    if (!saved) throw new CommerceError("Order not found.", 404);
    if (saved.value.status === "cancelled") return saved.value;
    if (saved.value.status !== "pending" || saved.value.attempt)
      throw new CommerceError(
        "An order with a payment in progress cannot be cancelled.",
        409,
      );
    const value: Order = { ...saved.value, status: "cancelled" };
    await this.store.write(path, value, saved.version);
    return value;
  }
  async events(p: Principal, cursor?: string) {
    const page = await this.store.list(
      `merchants/${p.workspace.id}/receipts/`,
      cursor,
    );
    const events = await Promise.all(
      page.paths.map(async (path) => (await this.store.read(path))!.value),
    );
    return {
      events,
      cursor: page.cursor,
      delivery:
        "Poll with the returned cursor; deduplicate by eventId. Restart a scan after cursor is absent.",
    };
  }
  async summary(p: Principal) {
    let cursor: string | undefined;
    let paid = 0n;
    let pending = 0n;
    let count = 0;
    let paidCount = 0;
    let overdue = 0;
    let processing = 0;
    do {
      const page = await this.listOrders(p, cursor);
      for (const order of page.orders) {
        count++;
        if (order.status === "paid") {
          paid += parseUsdcAmount(order.amount);
          paidCount++;
        }
        if (["pending", "processing"].includes(order.status)) {
          pending += parseUsdcAmount(order.amount);
          if (order.dueAt && order.dueAt < this.now()) overdue++;
        }
        if (order.status === "processing") processing++;
      }
      cursor = page.cursor;
      if (count >= 10000 && cursor)
        throw new CommerceError(
          "Use paginated order export for workspaces exceeding 10,000 orders.",
          422,
        );
    } while (cursor);
    return {
      count,
      paidCount,
      processing,
      overdue,
      paidUsdc: formatUnits(paid, 6),
      outstandingUsdc: formatUnits(pending, 6),
      chainId: ARC_CHAIN_ID,
      asOf: this.now(),
    };
  }
}

export function merchantOrder(order: Order) {
  return {
    ...publicOrder(order),
    customerReference: order.customerReference,
    paymentStartedAt: order.attempt?.startedAt,
  };
}
export function ordersCsv(orders: Order[]) {
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
      "due_at",
      "transaction_hash",
    ],
    ...orders.map((o) => [
      o.reference,
      o.customerReference,
      o.title,
      o.amount,
      o.status,
      o.createdAt,
      o.dueAt,
      o.receipt?.transactionHash,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
