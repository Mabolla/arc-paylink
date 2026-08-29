import Link from "next/link";
import { AuditLookup } from "@/components/audit-lookup";

export default function AuditPage() {
  return <main>
    <nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3</sup></Link><span className="network-pill"><i /> Arc Testnet</span></nav>
    <section className="audit-layout">
      <div className="claim-intro"><p className="eyebrow">Settlement audit</p><h1>Verify the obligation, not just the transaction.</h1><p className="lede">Match a business obligation to its Base burn, CCTP evidence, Arc mint, settlement state, and read-only recovery plan.</p></div>
      <AuditLookup />
    </section>
    <footer><span>Private shared records</span><span>No automatic fund movement</span></footer>
  </main>;
}
