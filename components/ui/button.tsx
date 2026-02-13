/* PHASE P1E.2 DISABLED HOVER LOCK (UI-only): keep disabled buttons from changing bg on hover */
"use client";
import * as React from "react";

type ButtonHTMLProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export type ButtonProps = ButtonHTMLProps & {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "sm" | "md" | "lg" | "icon";
};

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600 /* PHASE P1E.2 DISABLED HOVER LOCK */",
  outline: "border bg-white hover:bg-gray-50 disabled:hover:bg-white",
  ghost: "bg-transparent hover:bg-gray-50 disabled:hover:bg-transparent",
  destructive: "bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600",
  secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 disabled:hover:bg-gray-100",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "md", type = "button", ...props }, ref) => {
    const v = variantClasses[variant] ?? variantClasses.default;
    const s = sizeClasses[size] ?? sizeClasses.md;
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex items-center justify-center rounded-2xl border border-transparent ${v} ${s} transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed /* PHASE P1E.1 BUTTON CURSOR NOT ALLOWED */ ${className}`}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export default Button;



