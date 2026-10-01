import { CustomerCheckout } from "@/components/customer-checkout";
export default async function CheckoutDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const orderId =
    (await searchParams).order ?? "2caa3625-565c-474a-beba-40ea3c93ee01";
  return (
    <CustomerCheckout key={orderId} demo orderId={orderId} />
  );
}
