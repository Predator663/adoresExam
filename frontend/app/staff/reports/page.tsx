"use client";
import ResultsReport from "@/components/ResultsReport";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { useSession } from "@/lib/session";

/** ADM-11: the whole school's results (or one form, class, term, subject or exam) as PDF or Excel. Administrators only. */
export default function ResultsDownload() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  return (
    <Shell bare title="Download results">
      <StaffNav />
      {admin ? <ResultsReport /> : <p>Only administrators can download the school's results.</p>}
    </Shell>
  );
}
