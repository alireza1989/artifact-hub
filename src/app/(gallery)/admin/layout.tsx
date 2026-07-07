import { AdminNav } from "./admin-nav";

// Admin console shell (PLAN Phase 6.5). The session gate lives in each page (a
// layout is not re-rendered on every navigation, so it must never be the only
// auth check); this shell only provides the shared chrome.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <AdminNav />
      </div>
      {children}
    </div>
  );
}
