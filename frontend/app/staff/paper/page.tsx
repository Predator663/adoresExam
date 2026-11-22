"use client";
import PaperScan from "@/components/PaperScan";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { useSession } from "@/lib/session";

/** Administrators: scan a returned home package, mark it received, key in the answers. */
export default function PaperPage() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  return (
    <Shell bare title="Home packages">
      <StaffNav />
      {admin ? <PaperScan /> : <p>Only administrators can scan home packages.</p>}
    </Shell>
  );
}
