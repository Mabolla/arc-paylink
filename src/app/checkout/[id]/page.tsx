import { CustomerCheckout } from "@/components/customer-checkout";
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const orderId = (await params).id;
  return <CustomerCheckout key={orderId} orderId={orderId} />;
}
