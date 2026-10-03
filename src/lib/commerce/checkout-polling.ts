/** Bounded, non-overlapping reads while a payment is processing. Never sends funds. */
export function startCheckoutPolling(
  read: () => Promise<{ status: string }>,
  visible: () => boolean,
) {
  let stopped = false;
  let reads = 0;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => { stopped = true; clearTimeout(timer); };
  const schedule = () => { timer = setTimeout(() => { void tick(); }, 15000); };
  const tick = async () => {
    if (stopped) return;
    if (!visible()) { schedule(); return; }
    try {
      reads++;
      const order = await read();
      if (order.status !== "processing" || reads >= 20) { stop(); return; }
    } catch {
      // Provider/quota failures must not become an unlimited retry loop.
      stop();
      return;
    }
    if (!stopped) schedule();
  };
  schedule();
  return stop;
}
