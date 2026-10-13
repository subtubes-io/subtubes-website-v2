"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DiffMenuItem { id: string; label: string; hint: string; disabledReason?: string; run: () => void }

/** A small action menu for the code a reviewer selected or right-clicked in a diff. Text only: the three actions say what they do. */
export function DiffContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title: string; items: DiffMenuItem[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const close = useRef(onClose);
  close.current = onClose;
  // Keep the menu on screen: open toward the pointer, flipping above or left of it when there is no room.
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const left = x + box.width + 8 > window.innerWidth ? x - box.width : x;
    const top = y + box.height + 8 > window.innerHeight ? y - box.height : y;
    setPosition({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y, items.length]);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close.current(); };
    const dismiss = () => close.current();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", dismiss); window.addEventListener("resize", dismiss);
    // Scrolling that brought the line into view can still be dispatching when the menu opens.
    const onScroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) dismiss(); };
    const arm = window.setTimeout(() => document.addEventListener("scroll", onScroll, true), 250);
    return () => {
      window.clearTimeout(arm); document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss); window.removeEventListener("resize", dismiss);
    };
  }, []);
  // Rendered on the body: a transformed ancestor (the animated drawer) would otherwise become the containing block of position:fixed.
  return createPortal(<div ref={root} className="diff-menu" role="menu" aria-label="Diff line actions" style={position}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key === "Tab") { close.current(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(root.current!.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next].focus();
    }}>
    <div className="diff-menu-title" role="presentation">{title}</div>
    {items.map((item) => <button type="button" role="menuitem" key={item.id} disabled={!!item.disabledReason} title={item.disabledReason}
      onClick={() => { close.current(); item.run(); }}>
      <span>{item.label}</span><small>{item.disabledReason ?? item.hint}</small>
    </button>)}
  </div>, document.body);
}
