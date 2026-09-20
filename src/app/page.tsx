import { RequestForm } from "@/components/request-form";
import Link from "next/link";
import { ARC_NETWORK_NAME, IS_ARC_MAINNET } from "@/lib/arc";

export default function Home() {
  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3.1</sup></Link>
        <div className="top-actions"><Link href="/requests">My Requests</Link><Link href="/test-recipient">Create walletless PayLink</Link>{!IS_ARC_MAINNET && <Link href="/audit">Verify settlement</Link>}<span className="network-pill"><i /> {ARC_NETWORK_NAME}</span></div>
      </nav>
      <section className="home-grid">
        <div className="intro">
          <p className="eyebrow">Programmable USDC payments</p>
          <h1>Request payment.<br />Settle on Arc.</h1>
          <p className="lede">Create a precise USDC request and share one link. Payment settles on {ARC_NETWORK_NAME} and ends with a receipt verified from the chain.</p>
          <div className="trust-row"><span>01</span> No custody <span>02</span> Exact amount <span>03</span> Onchain proof</div>
        </div>
        <section className="form-panel">
          <div className="panel-heading"><div><p className="eyebrow">New request</p><h2>Payment details</h2></div><span className="step">Step 1 of 1</span></div>
          <RequestForm />
          <p className="fine-print">Request status is stored privately while the creator capability stays in this browser. Arc PayLink never asks for a private key or seed phrase.</p>
        </section>
      </section>
      <footer><span>Built for Arc</span><span>USDC · {IS_ARC_MAINNET ? "Mainnet pilot" : "Testnet only"}</span></footer>
    </main>
  );
}
