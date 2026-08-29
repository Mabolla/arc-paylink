import Link from "next/link";
import { RecipientWallet } from "@/components/recipient-wallet";

export default function ClaimPage() {
  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3</sup></Link>
        <span className="network-pill"><i /> Arc Testnet</span>
      </nav>
      <div className="claim-layout">
        <section className="claim-intro">
          <p className="eyebrow">Claim on Arc</p>
          <h1>Your payment.<br />Your wallet.</h1>
          <p className="lede">A sender can fund the PayLink before you have a wallet. Sign in, create your recipient wallet, then authorize the address-bound claim.</p>
          <div className="trust-row"><span>01</span> Google sign-in <span>02</span> User-controlled wallet <span>03</span> Bound claim</div>
        </section>
        <RecipientWallet />
      </div>
      <footer><span>Non-custodial recipient onboarding</span><span>USDC · Testnet only</span></footer>
    </main>
  );
}
