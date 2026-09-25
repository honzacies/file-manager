import type { ReactNode } from "react";
import { Panel } from "./Panel";

// Seznam položek v kartě (koš, sdílení, uživatelé, nedávné…) — jednotný vzhled na všech stránkách.
export function ListPanel({ children }: { children: ReactNode }) {
  return (
    <Panel className="p-2!">
      <ul className="flex flex-col divide-y divide-separator">{children}</ul>
    </Panel>
  );
}

// Řádek, který se otevírá klikem. Klik na tlačítka uvnitř (⋮, stáhnout…) řádek neotevře;
// klávesnice jde přes ta tlačítka.
export function ClickableRow({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klávesnice jde přes tlačítka v řádku
    // biome-ignore lint/a11y/noStaticElementInteractions: viz výše
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-default/60"
      onClick={(event) => !(event.target as HTMLElement).closest("button") && onOpen()}
    >
      {children}
    </div>
  );
}
