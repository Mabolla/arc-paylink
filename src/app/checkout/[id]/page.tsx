import { CustomerCheckout } from "@/components/customer-checkout";
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CustomerCheckout orderId={(await params).id} />;
}
