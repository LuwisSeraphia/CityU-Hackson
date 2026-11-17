"use client";
import { useState, type FormHTMLAttributes } from "react";

/** Uses HTML constraints while keeping validation feedback inside the application. */
export function Form({
  children,
  onSubmit,
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  const [error, setError] = useState("");
  return (
    <form
      {...props}
      noValidate
      onSubmit={(event) => {
        const invalid = event.currentTarget.querySelector<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >(":invalid");
        if (invalid) {
          event.preventDefault();
          setError(
            invalid.validity.valueMissing
              ? "请填写必填内容。"
              : "请检查输入格式或允许的数值范围。",
          );
          invalid.focus();
          return;
        }
        setError("");
        onSubmit?.(event);
      }}
    >
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
