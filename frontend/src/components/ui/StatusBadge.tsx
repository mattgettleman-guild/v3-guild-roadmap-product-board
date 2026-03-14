import { SEMANTIC_STATUS } from "./tokens";

interface Props {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "sm" }: Props) {
  const style = SEMANTIC_STATUS[status] ?? SEMANTIC_STATUS["Not Started"];
  const padding = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium border ${padding}`}
      style={{ backgroundColor: style.bg, color: style.text, borderColor: style.border }}
    >
      {status}
    </span>
  );
}
