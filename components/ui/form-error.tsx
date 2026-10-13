import type { ComponentProps } from "react";

export function FormError({
  className = "",
  ...props
}: Omit<ComponentProps<"p">, "role">) {
  return (
    <p
      {...props}
      role="alert"
      className={`form-error${className ? ` ${className}` : ""}`}
    />
  );
}
