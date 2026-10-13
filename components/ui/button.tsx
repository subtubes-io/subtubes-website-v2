import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary";
  size?: "default" | "compact";
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  size = "default",
  fullWidth = false,
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`button-${variant}${size === "compact" ? " button-compact" : ""}${fullWidth ? " button-block" : ""}${className ? ` ${className}` : ""}`}
    />
  );
}
