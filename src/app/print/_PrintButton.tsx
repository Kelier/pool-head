"use client";

export function PrintButton() {
  return (
    <button className="btn no-print" onClick={() => window.print()}>
      打印 / 另存为 PDF
    </button>
  );
}
