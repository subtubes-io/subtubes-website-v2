"use client";

// Sends a change to one of the website's management routes and turns a refusal into an Error with the server's message.
export async function sendJson<T = unknown>(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T | null> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null) as ({ message?: string } & T) | null;
  if (!response.ok) throw new Error(data?.message ?? "The request failed. Please try again.");
  return data;
}

export function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  const digits = usd !== 0 && Math.abs(usd) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits })
    .format(usd);
}

export const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);

/** The text of a dollar input: empty means no limit; undefined means it is not a valid amount. */
export function parseUsdInput(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

export const usdInputValue = (micros: number | null) => (micros === null ? "" : String(micros / 1_000_000));
