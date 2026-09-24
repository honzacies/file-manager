import { Icon } from "./Icon";

export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`grid place-items-center rounded-xl bg-accent text-accent-foreground ${large ? "size-10" : "size-8"}`}>
        <Icon name="cloud" filled className={large ? "text-[24px]" : "text-[20px]"} />
      </span>
      <span className={`font-semibold tracking-tight ${large ? "text-xl" : "text-lg"}`}>Cloud</span>
    </div>
  );
}
