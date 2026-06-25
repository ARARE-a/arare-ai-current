import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARARE AI",
  description: "AI Reception & Reservation Operating System"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const body = <body>{children}</body>;

  return (
    <html lang="ja">
      {clerkEnabled ? <ClerkProvider>{body}</ClerkProvider> : body}
    </html>
  );
}
