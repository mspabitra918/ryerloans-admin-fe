// "use client";

// import Link from "next/link";
// import { usePathname } from "next/navigation";
// import {
//   FileSearch,
//   LayoutDashboard,
//   LogOut,
//   ShieldCheck,
//   Users,
// } from "lucide-react";

// import { can, ROLE_LABELS } from "@/lib/auth";
// import { useSession } from "./SessionProvider";

// const NAV = [
//   { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
//   { href: "/applications", label: "Applications", icon: FileSearch },
//   { href: "/users", label: "Admin users", icon: Users, superAdminOnly: true },
// ];

// export function Sidebar() {
//   const pathname = usePathname();
//   const { admin, signOut } = useSession();

//   return (
//     <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
//       <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-4">
//         <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
//           <ShieldCheck size={18} aria-hidden />
//         </span>
//         <div className="min-w-0">
//           <p className="truncate text-sm font-semibold">Ryer Loans</p>
//           <p className="text-xs text-[var(--foreground-muted)]">Admin portal</p>
//         </div>
//       </div>

//       <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
//         {NAV.filter(
//           (item) => !item.superAdminOnly || can.manageUsers(admin?.role),
//         ).map((item) => {
//           const active =
//             pathname === item.href || pathname.startsWith(`${item.href}/`);
//           const Icon = item.icon;

//           return (
//             <Link
//               key={item.href}
//               href={item.href}
//               aria-current={active ? "page" : undefined}
//               className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
//                 active
//                   ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-strong)]"
//                   : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
//               }`}
//             >
//               <Icon size={16} aria-hidden />
//               {item.label}
//             </Link>
//           );
//         })}
//       </nav>

//       <div className="border-t border-[var(--border)] p-3">
//         <div className="mb-2 px-1">
//           <p className="truncate text-sm font-medium" title={admin?.email}>
//             {admin?.email ?? "—"}
//           </p>
//           <p className="text-xs text-[var(--foreground-muted)]">
//             {admin ? ROLE_LABELS[admin.role] : ""}
//           </p>
//         </div>

//         <button
//           type="button"
//           onClick={() => void signOut()}
//           className="btn btn-secondary w-full"
//         >
//           <LogOut size={15} aria-hidden />
//           Sign out
//         </button>
//       </div>
//     </aside>
//   );
// }

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Star,
  Users,
  X,
} from "lucide-react";

import { can, ROLE_LABELS } from "@/lib/auth";
import { useSession } from "./SessionProvider";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: FileSearch },
  /*
   * Listed for every role: §8.1 puts `view` on all five lines, and a queue of
   * submitted reviews is a view. Only the publish/reject buttons inside are
   * restricted to super_admin.
   */
  // { href: "/reviews", label: "Reviews", icon: Star },
  {
    href: "/users",
    label: "Admin users",
    icon: Users,
    superAdminOnly: true,
  },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onMobileClose: () => void;
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggle,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const { admin, signOut } = useSession();

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col
          border-r border-[var(--border)] bg-[var(--surface)]
          transition-all duration-200
          
          lg:static lg:z-auto lg:translate-x-0
          
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          
          ${collapsed ? "lg:w-20" : "lg:w-60"}
          
          w-60
        `}
      >
        {/* Header */}
        <div
          className={`
            flex h-[73px] items-center border-b border-[var(--border)]
            ${collapsed ? "justify-center px-3" : "gap-2 px-4"}
          `}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
            <ShieldCheck size={18} aria-hidden />
          </span>

          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Ryer Loans</p>
              <p className="text-xs text-[var(--foreground-muted)]">
                Admin portal
              </p>
            </div>
          )}

          {/* Mobile close */}
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto rounded-md p-1.5 text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] lg:hidden"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav
          className="flex-1 space-y-1 overflow-y-auto p-3"
          aria-label="Primary"
        >
          {NAV.filter(
            (item) => !item.superAdminOnly || can.manageUsers(admin?.role),
          ).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onMobileClose}
                title={collapsed ? item.label : undefined}
                className={`
                  flex items-center rounded-lg py-2 text-sm transition-colors
                  ${collapsed ? "justify-center px-2" : "gap-2.5 px-3"}
                  ${
                    active
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-strong)]"
                      : "text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                  }
                `}
              >
                <Icon size={16} aria-hidden />

                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User / Logout */}
        <div className="border-t border-[var(--border)] p-3">
          {!collapsed && (
            <div className="mb-2 px-1">
              <p className="truncate text-sm font-medium" title={admin?.email}>
                {admin?.email ?? "—"}
              </p>

              <p className="text-xs text-[var(--foreground-muted)]">
                {admin ? ROLE_LABELS[admin.role] : ""}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void signOut()}
            title={collapsed ? "Sign out" : undefined}
            className={`
              btn btn-secondary w-full
              ${collapsed ? "justify-center px-2" : ""}
            `}
          >
            <LogOut size={15} aria-hidden />

            {!collapsed && <span>Sign out</span>}
          </button>
        </div>

        {/* Desktop collapse button */}
        <button
          type="button"
          onClick={onToggle}
          className="absolute -right-3 top-7 hidden h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:bg-[var(--surface-muted)] lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Menu size={14} />
        </button>
      </aside>
    </>
  );
}
