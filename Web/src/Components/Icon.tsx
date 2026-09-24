// Material Symbols (self-hosted přes balíček `material-symbols`, ligatury —
// jméno ikony je text obsahu). Stejný vzor jako Tool Suite.
export function Icon({
  name,
  className,
  filled,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`material-symbols-outlined select-none ${className ?? ""}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}
