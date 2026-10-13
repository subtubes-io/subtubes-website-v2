"use client";
import { useEffect, useId, useRef, useState } from "react";

interface SelectConfig {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function ThemedSelect({ config }: { config: SelectConfig }) {
  const { label, value, options, onChange } = config;
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const host = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", time: 0 });
  const id = useId();
  const selected = options.findIndex((option) => option.value === value);
  const reveal = () => { setActive(Math.max(0, selected)); setOpen(true); };
  const choose = (index: number) => { onChange(options[index].value); setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [open, active, id]);
  return <div className="themed-select" ref={host} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={button} type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => open ? setOpen(false) : reveal()} onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const start = open ? active : Math.max(0, selected);
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
            Math.max(0, Math.min(options.length - 1, start + (event.key === "ArrowDown" ? 1 : -1))));
          setOpen(true);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (open) choose(active); else reveal();
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now(), letter = event.key.toLowerCase();
          const text = now - search.current.time < 700 ? search.current.text + letter : letter;
          search.current = { text, time: now };
          const index = options.findIndex((option) => option.label.toLowerCase().startsWith(text));
          if (index >= 0) { event.preventDefault(); setActive(index); setOpen(true); }
        }
      }}>
      <span>{options[selected]?.label ?? value}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="themed-select-menu" id={id} role="listbox" aria-label={label}>
      {options.map((option, index) => <div id={`${id}-${index}`} role="option" aria-selected={option.value === value}
        className={active === index ? "active" : ""} key={option.value} onPointerMove={() => setActive(index)}
        onPointerDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        <span className="select-check" aria-hidden="true">{option.value === value ? "\u2713" : ""}</span>{option.label}
      </div>)}
    </div>}
  </div>;
}
