"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  id,
  maxHeight = 280,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
  maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className={`custom-select ${open ? "is-open" : ""}`} ref={wrapRef}>
      <button
        id={id}
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={value ? "" : "is-placeholder"}>{value || placeholder}</span>
        <ChevronDown size={16} className="custom-select-chevron" />
      </button>
      {open && (
        <ul
          className="custom-select-list"
          role="listbox"
          style={{ maxHeight }}
        >
          {options.map((option) => (
            <li
              key={option}
              role="option"
              aria-selected={option === value}
              className={`custom-select-option ${option === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span>{option}</span>
              {option === value && <Check size={14} />}
            </li>
          ))}
          {options.length === 0 && <li className="custom-select-empty">No options</li>}
        </ul>
      )}
    </div>
  );
}
