"use client";
import LockedAccounts from "@/components/LockedAccounts";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { useSession } from "@/lib/session";

/** Super Admin only: locked student accounts, with unlock and new-password actions (API: accounts/lockouts.py). */
export default function Lockouts() {
  const { user } = useSession();
  return (
    <Shell bare title="Locked accounts">
      <StaffNav />
      {user?.role === "super_admin" ? <LockedAccounts /> : <p>Only a Super Admin can see and unlock locked accounts.</p>}
    </Shell>
  );
}
