import Link from "next/link";
import { TesterPayLinkCreator } from "@/components/tester-paylink-creator";
import { ARC_NETWORK_NAME, IS_ARC_MAINNET } from "@/lib/arc";

export default function TestRecipientPage() {
  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3.1</sup></Link>
        <span className="network-pill"><i /> {ARC_NETWORK_NAME}</span>
      </nav>
      <div className="claim-layout">
        <section className="claim-intro">
          <p className="eyebrow">Send on Arc</p>
          <h1>One payment.<br />One private link.</h1>
          <p className="lede">Fund a single-use escrow for someone who does not already have a crypto wallet. They claim through a user-controlled Circle wallet.</p>
          <div className="trust-row"><span>01</span> Isolated escrow <span>02</span> One private link <span>03</span> Onchain verified</div>
        </section>
        <TesterPayLinkCreator />
      </div>
      <footer><span>Non-custodial escrow payment</span><span>USDC · {IS_ARC_MAINNET ? "Mainnet pilot" : "Testnet only"}</span></footer>
    </main>
  );
}
