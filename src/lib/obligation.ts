export const OBLIGATION_KINDS = ["invoice", "milestone", "agent-task"] as const;

export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export type PaymentObligation = {
  kind: ObligationKind;
  id: string;
};

export function createObligation(input: { kind?: string; id?: string }): PaymentObligation | undefined {
  const kind = input.kind?.trim();
  const id = input.id?.trim();
  if (!kind && !id) return undefined;
  if (!OBLIGATION_KINDS.includes(kind as ObligationKind)) throw new Error("Choose a valid obligation type.");
  if (!id || id.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new Error("Obligation ID must be 1-64 letters, numbers, or . _ : / - characters.");
  }
  return { kind: kind as ObligationKind, id };
}

