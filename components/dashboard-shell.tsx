"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings, UserRound } from "lucide-react";

const storageKey = "subtubes-org-drawer";
const drawerEvent = "subtubes-org-drawer-change";
type Drawer = "open" | "closed";

// What the person chose last; before they have chosen, a phone starts with the drawer closed so the page is not hidden behind it.
function snapshot(): Drawer {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "open" || saved === "closed") return saved;
  } catch {
    // Not being able to read it only means the default.
  }
  return window.matchMedia("(max-width: 720px)").matches ? "closed" : "open";
}

function subscribe(onChange: () => void) {
  window.addEventListener(drawerEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(drawerEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const pages = [
  { name: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { name: "Account", href: "/dashboard/account", Icon: Settings },
  { name: "Profile", href: "/dashboard/profile", Icon: UserRound },
] as const;

// The signed-in person's pages: a drawer on the left that collapses, and the chosen page beside it.
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const drawer = useSyncExternalStore(subscribe, snapshot, () => "open" as Drawer);
  const open = drawer === "open";

  function toggle() {
    try {
      localStorage.setItem(storageKey, open ? "closed" : "open");
    } catch {
      // The drawer still works for this visit; it is just not remembered.
    }
    window.dispatchEvent(new Event(drawerEvent));
  }

  return (
    <div className={`org-shell${open ? "" : " org-shell-closed"}`}>
      <aside id="dashboard-drawer" className="org-drawer" aria-label="Dashboard" hidden={!open}>
        <nav aria-label="Dashboard pages">
          <ul>
            {pages.map(({ name, href, Icon }) => {
              const current = href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link href={href} className="org-drawer-link" aria-current={current ? "page" : undefined}>
                    <Icon size={16} aria-hidden="true" />
                    {name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className="org-content">
        <button type="button" className="org-drawer-toggle" aria-expanded={open} aria-controls="dashboard-drawer"
          aria-label={open ? "Close the menu" : "Open the menu"} title={open ? "Close the menu" : "Open the menu"} onClick={toggle}>
          {open ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
        </button>
        <section className="dashboard-wrap">{children}</section>
      </div>
    </div>
  );
}
