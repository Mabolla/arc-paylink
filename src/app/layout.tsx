import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arc PayLink v3.1",
  description: "Create, manage, settle, audit, and safely recover obligation-aware USDC payments on Arc Testnet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
