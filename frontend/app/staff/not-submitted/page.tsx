"use client";
import NotSubmitted from "@/components/NotSubmitted";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { useSession } from "@/lib/session";

/** Administrators: who has not submitted an exam (search, filter, print, PDF, Excel). */
export default function NotSubmittedPage() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  return (
    <Shell bare title="Not submitted">
      <StaffNav />
      {admin ? <NotSubmitted /> : <p>Only administrators can see who has not submitted an exam.</p>}
    </Shell>
  );
}
