import { CustomerCheckout } from "@/components/customer-checkout";
export default async function CheckoutDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  return (
    <CustomerCheckout
      demo
      orderId={
        (await searchParams).order ?? "2caa3625-565c-474a-beba-40ea3c93ee01"
      }
    />
  );
}
