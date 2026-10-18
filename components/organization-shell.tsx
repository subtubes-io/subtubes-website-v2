"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { FileText, PanelLeftClose, PanelLeftOpen, Users } from "lucide-react";

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
  { name: "Users", path: "users", Icon: Users },
  { name: "Reports", path: "reports", Icon: FileText },
] as const;

// The organization's pages: a drawer on the left that collapses, and the chosen page beside it.
export function OrganizationShell({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const drawer = useSyncExternalStore(subscribe, snapshot, () => "open" as Drawer);
  const open = drawer === "open";
  const base = `/dashboard/organizations/${encodeURIComponent(slug)}`;

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
      <aside id="organization-drawer" className="org-drawer" aria-label="Organization" hidden={!open}>
        <nav aria-label="Organization pages">
          <ul>
            {pages.map(({ name, path, Icon }) => {
              const href = `${base}/${path}`;
              const current = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={path}>
                  <Link href={href} className="org-drawer-link" aria-current={current ? "page" : undefined}>
                    <Icon size={16} aria-hidden="true" />
                    {name}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link href="/dashboard" className="org-drawer-back">All organizations</Link>
        </nav>
      </aside>
      <div className="org-content">
        <button type="button" className="org-drawer-toggle" aria-expanded={open} aria-controls="organization-drawer"
          aria-label={open ? "Close the menu" : "Open the menu"} title={open ? "Close the menu" : "Open the menu"} onClick={toggle}>
          {open ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}
        </button>
        <section className="dashboard-wrap">{children}</section>
      </div>
    </div>
  );
}
