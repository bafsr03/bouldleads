import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { FeedbackHost } from "@/components/feedback";
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
  title: { default: "BouldLeads", template: "%s · BouldLeads" },
  description: "Find local businesses, discover their public contact emails, and run compliant outreach campaigns.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full md:flex">
        <Suspense fallback={<aside className="border-b border-border bg-surface md:h-screen md:w-60 md:border-r" />}>
          <Nav />
        </Suspense>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
        <FeedbackHost />
      </body>
    </html>
  );
}
