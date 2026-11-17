import type { ButtonHTMLAttributes } from "react";
export function Button({
  className = "",
  variant = "ghost",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "solid" | "outline";
}) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      onClick={onClick}
      {...props}
    />
  );
}
