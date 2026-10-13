import type { ComponentProps } from "react";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`site-input${className ? ` ${className}` : ""}`}
    />
  );
}
