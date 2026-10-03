import type { PublicOrder, Workspace } from "./types";
export type DashboardOrder = PublicOrder & {
  customerReference: string;
  paymentStartedAt?: string;
};
const KEY = "arcpaylink.commerce.sandbox.v1";
const MERCHANT = "da6b4ec8-51bd-47ab-88b5-4c4b928a1481";
const recipient = "0x1111111111111111111111111111111111111111" as const;
export const demoWorkspace: Workspace = {
  id: MERCHANT,
  name: "Studio North · Sandbox",
  recipient,
  chainId: 5042002,
  createdAt: "2026-10-01T12:00:00.000Z",
};
export function demoOrders(): DashboardOrder[] {
  const saved = localStorage.getItem(KEY);
  if (saved) return JSON.parse(saved);
  const orders: DashboardOrder[] = [
    {
      id: "2caa3625-565c-474a-beba-40ea3c93ee01",
      title: "Website delivery",
      reference: "INV-1042",
      amount: "250",
      customerReference: "Acme Studio",
      status: "pending",
      dueAt: "2026-10-10T12:00:00.000Z",
    },
    {
      id: "2caa3625-565c-474a-beba-40ea3c93ee02",
      title: "Design retainer",
      reference: "INV-1041",
      amount: "125",
      customerReference: "Orbit Labs",
      status: "paid",
      receipt: {
        transactionHash: `0x${"a".repeat(64)}`,
        sender: "0x2222222222222222222222222222222222222222",
        blockNumber: "0",
        confirmedAt: "2026-10-01T11:15:00.000Z",
      },
    },
    {
      id: "2caa3625-565c-474a-beba-40ea3c93ee03",
      title: "Brand workshop",
      reference: "INV-1040",
      amount: "80",
      customerReference: "Field Office",
      status: "pending",
      dueAt: "2026-09-28T12:00:00.000Z",
    },
  ].map(
    (o) =>
      ({
        ...o,
        merchantName: demoWorkspace.name,
        recipient,
        chainId: 5042002,
        createdAt: "2026-10-01T10:00:00.000Z",
      }) as DashboardOrder,
  );
  localStorage.setItem(KEY, JSON.stringify(orders));
  return orders;
}
export function saveDemoOrders(orders: DashboardOrder[]) {
  localStorage.setItem(KEY, JSON.stringify(orders));
}
export function demoPay(id: string) {
  const orders = demoOrders();
  const order = orders.find((o) => o.id === id);
  if (!order || order.status !== "pending") return order;
  order.status = "paid";
  order.receipt = {
    transactionHash: `0x${"d".repeat(64)}`,
    sender: "0x2222222222222222222222222222222222222222",
    blockNumber: "0",
    confirmedAt: new Date().toISOString(),
  };
  saveDemoOrders(orders);
  return order;
}
