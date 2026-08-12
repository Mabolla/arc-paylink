import Link from "next/link";
import { PaymentPanel } from "@/components/payment-panel";
import { createPaymentRequest } from "@/lib/payment-request";

export default async function PayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let request;
  try {
    request = createPaymentRequest({
      title: String(params.title ?? ""),
      amount: String(params.amount ?? ""),
      recipient: String(params.recipient ?? ""),
    });
  } catch {
    return <main><nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v2</sup></Link></nav><div className="empty-state"><p className="eyebrow">Invalid link</p><h1>This payment request is incomplete.</h1><Link className="primary-button" href="/">Create a new request</Link></div></main>;
  }
  return (
    <main>
      <nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v2</sup></Link><span className="network-pill"><i /> Arc Testnet</span></nav>
      <div className="pay-layout"><PaymentPanel {...request} /></div>
      <footer><span>Verified settlement on Arc</span><span>USDC · Testnet only</span></footer>
    </main>
  );
}
