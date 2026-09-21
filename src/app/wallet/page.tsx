import Link from "next/link";
import { RecipientWalletDashboard } from "@/components/recipient-wallet-dashboard";
import { ARC_NETWORK_NAME, IS_ARC_MAINNET } from "@/lib/arc";

export default function WalletPage() {
  return <main>
    <nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3.1</sup></Link><span className="network-pill"><i /> {ARC_NETWORK_NAME}</span></nav>
    <div className="claim-layout">
      <section className="claim-intro"><p className="eyebrow">Wallet on Arc</p><h1>Your USDC.<br />Under your control.</h1><p className="lede">Return with the same Google account to view the wallet created for your PayLink claim and send its USDC on Arc.</p><div className="trust-row"><span>01</span> Google access <span>02</span> Onchain balance <span>03</span> Secure approval</div></section>
      <RecipientWalletDashboard />
    </div>
    <footer><span>User-controlled Circle wallet</span><span>USDC · {IS_ARC_MAINNET ? "Mainnet pilot" : "Testnet only"}</span></footer>
  </main>;
}
