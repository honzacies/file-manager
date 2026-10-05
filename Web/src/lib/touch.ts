import { useSyncExternalStore } from "react";

// Telefon nebo tablet = hlavní ovládání prstem. Notebook s dotykovou obrazovkou má myš jako hlavní
// ukazatel (pointer: fine), takže zůstává u ovládání myší.
const QUERY = "(pointer: coarse)";

export function useTouch() {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(QUERY);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    // statický export se předrenderuje bez okna
    () => false,
  );
}
