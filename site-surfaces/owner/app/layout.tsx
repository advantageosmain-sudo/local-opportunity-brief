import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Opportunity Brief Owner Dashboard",
  description: "Michelle's private command center for briefs, prospects, schedules, and offers.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
