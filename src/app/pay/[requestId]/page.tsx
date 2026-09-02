import Link from "next/link";
import { ManagedPaymentPage } from "@/components/managed-payment-page";
export default async function ManagedPayPage({params}:{params:Promise<{requestId:string}>}){const{requestId}=await params;return <main><nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3.1</sup></Link><span className="network-pill"><i/> Arc Testnet</span></nav><ManagedPaymentPage requestId={requestId}/><footer><span>Verified settlement on Arc</span><span>USDC · Testnet only</span></footer></main>}
