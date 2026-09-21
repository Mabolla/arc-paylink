import Link from "next/link";
import { ManagedPaymentPage } from "@/components/managed-payment-page";
import { ARC_NETWORK_NAME, IS_ARC_MAINNET } from "@/lib/arc";
export default async function ManagedPayPage({params}:{params:Promise<{requestId:string}>}){const{requestId}=await params;return <main><nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span>Arc PayLink <sup>v3.1</sup></Link><span className="network-pill"><i/> {ARC_NETWORK_NAME}</span></nav><ManagedPaymentPage requestId={requestId}/><footer><span>Verified settlement on Arc</span><span>USDC · {IS_ARC_MAINNET?"Mainnet pilot":"Testnet only"}</span></footer></main>}
