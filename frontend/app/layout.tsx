import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { SessionProvider } from "@/lib/session";
import { BrandProvider } from "@/lib/brand";
import OfflineBar from "@/components/OfflineBar";
import SwRegister from "@/components/SwRegister";
import MaintenanceGate from "@/components/MaintenanceGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Online Exams",
  description: "Online examinations",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Exams", statusBarStyle: "default" },  // the school's own name and logo are set by BrandProvider
};
export const viewport: Viewport = { themeColor: "#0b6b4f", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider><BrandProvider><OfflineBar />{children}</BrandProvider></SessionProvider>
        <MaintenanceGate />
        <SwRegister />
      </body>
    </html>
  );
}
