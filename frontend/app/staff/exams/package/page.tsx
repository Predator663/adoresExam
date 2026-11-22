"use client";
import HomePackage from "@/components/HomePackage";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { useSession } from "@/lib/session";

/** Administrators: print the home package of an exam (open this page with ?id=<exam id>). */
export default function PackagePage() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  return (
    <Shell bare title="Home package">
      <StaffNav />
      {admin ? <HomePackage /> : <p>Only administrators can print home packages.</p>}
    </Shell>
  );
}
