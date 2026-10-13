import type { ReactNode } from "react";

export type TableColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
};

export type TableConfig<Row> = {
  caption: string;
  columns: readonly [TableColumn<Row>, ...TableColumn<Row>[]];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  state?: "ready" | "loading" | "error";
  emptyMessage?: string;
  errorMessage?: string;
};

export function Table<Row>({ config }: { config: TableConfig<Row> }) {
  const {
    caption, columns, rows, rowKey, state = "ready",
    emptyMessage = "No records to display.",
    errorMessage = "Could not load records. Please try again.",
  } = config;
  return (
    <div className="table-scroll" role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className="shared-table" aria-busy={state === "loading"}>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => (
            <th key={column.id} scope="col" className={column.align === "right" ? "table-align-right" : undefined}>
              {column.header}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {state !== "ready" || rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="table-state">
              <p role={state === "error" ? "alert" : "status"}>
                {state === "loading" ? "Loading records..." : state === "error" ? errorMessage : emptyMessage}
              </p>
            </td></tr>
          ) : rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((column) => (
              <td key={column.id} className={column.align === "right" ? "table-align-right" : undefined}>
                {column.cell(row)}
              </td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
