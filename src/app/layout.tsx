import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arc PayLink v2",
  description: "Create and settle verifiable USDC payment requests on Arc Testnet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
