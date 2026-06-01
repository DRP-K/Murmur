import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BootstrapShell } from "@/hooks/BootstrapShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Murmur — whisper to your friends",
  description: "Anonymous feed, private DMs, and QR-based friend discovery.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-zinc-50 [overflow-y:scroll]">
        <BootstrapShell>{children}</BootstrapShell>
      </body>
    </html>
  );
}
