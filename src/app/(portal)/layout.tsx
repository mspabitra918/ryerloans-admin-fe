// import { SessionProvider } from "@/components/shell/SessionProvider";
// import { Sidebar } from "@/components/shell/Sidebar";

// export default function PortalLayout({
//   children,
// }: {
//   children: React.ReactNode;
// }) {
//   return (
//     <SessionProvider>
//       <div className="flex min-h-screen">
//         <Sidebar />
//         <div className="min-w-0 flex-1">
//           <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
//         </div>
//       </div>
//     </SessionProvider>
//   );
// }

"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { SessionProvider } from "@/components/shell/SessionProvider";
import { Sidebar } from "@/components/shell/Sidebar";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <SessionProvider>
      <div className="flex min-h-screen bg-[var(--background)]">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggle={() => setCollapsed((prev) => !prev)}
          onMobileClose={() => setMobileOpen(false)}
        />

        <div className="min-w-0 flex-1">
          {/* Mobile header */}
          <header className="sticky top-0 z-30 flex h-14 items-center border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
              aria-label="Open sidebar"
            >
              <Menu size={20} />
            </button>

            <div className="ml-3">
              <p className="text-sm font-semibold">Ryer Loans</p>
            </div>
          </header>

          <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
