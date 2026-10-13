"use client";
import type { MouseEvent, ReactNode } from "react";

/** The page heading shared by every list: a title with its detail, and the page's actions on the right. */
export function ListHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return <div className="list-head">
    <div className="list-title"><h2>{title}</h2>{meta && <span className="loc">{meta}</span>}</div>
    {actions && <div className="list-actions">{actions}</div>}
  </div>;
}

/** The search box every list has, with room for a control such as a sort order beside it. */
export function ListSearch({ id, label, placeholder, value, onChange, children }: {
  id?: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; children?: ReactNode;
}) {
  return <div className="list-bar">
    <input id={id} type="search" aria-label={label} placeholder={placeholder} value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    {children}
  </div>;
}

/** A simple table: one header row, then rows. `columns` is the CSS grid template shared by the header and every row. */
export function ListTable({ label, columns, headings, children }: { label: string; columns: string; headings: string[]; children: ReactNode }) {
  return <div role="table" aria-label={label} className="list-table" style={{ "--list-columns": columns } as React.CSSProperties}>
    <div role="row" className="list-row list-columns">{headings.map((heading, index) => <div role="columnheader" key={heading || index}>{heading}</div>)}</div>
    {children}
  </div>;
}

/** One row. Clicking anywhere on it that is not a control opens it too; keyboard users open it with the name button inside. */
export function ListRow({ onOpen, label, children, ...data }: { onOpen?: () => void; label?: string; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return <div role="row" className={`list-row${onOpen ? " list-row-open" : ""}`} aria-label={label} {...data}
    onClick={onOpen ? (event: MouseEvent) => { if (!(event.target as HTMLElement).closest("button, a, input, select, textarea, summary")) onOpen(); } : undefined}>
    {children}
  </div>;
}

/** The name as a button: it is how a row is opened from the keyboard and by assistive technology. */
export const OpenName = ({ name, label, onOpen, disabled }: { name: ReactNode; label?: string; onOpen: () => void; disabled?: boolean }) =>
  <button type="button" className="list-open" aria-label={label} disabled={disabled} onClick={onOpen}>{name}</button>;

/** A cell with a main line and an optional quieter line under it. */
export function NameCell({ name, detail, badges }: { name: ReactNode; detail?: ReactNode; badges?: ReactNode }) {
  return <div role="cell" className="list-name">
    <div className="list-name-main">{name}{badges}</div>
    {detail && <div className="list-name-detail">{detail}</div>}
  </div>;
}

export const ListCell = ({ children, className }: { children?: ReactNode; className?: string }) => <div role="cell" className={className}>{children}</div>;
export const ListEmpty = ({ children }: { children: ReactNode }) => <div className="list-empty">{children}</div>;
