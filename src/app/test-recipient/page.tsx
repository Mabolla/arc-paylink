import Link from "next/link";
import { TesterPayLinkCreator } from "@/components/tester-paylink-creator";

export default function TestRecipientPage() {
  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3</sup></Link>
        <span className="network-pill"><i /> Arc Testnet</span>
      </nav>
      <div className="claim-layout">
        <section className="claim-intro">
          <p className="eyebrow">Merchant test setup</p>
          <h1>One tester.<br />One escrow.</h1>
          <p className="lede">Prepare a fresh, single-use recipient test without sharing a funded key or opening a reusable public reward pool.</p>
          <div className="trust-row"><span>01</span> Isolated escrow <span>02</span> Private package <span>03</span> Onchain verified</div>
        </section>
        <TesterPayLinkCreator />
      </div>
      <footer><span>Controlled external testing</span><span>USDC · Testnet only</span></footer>
    </main>
  );
}
