// Kam po přihlášení: jen stránka v téhle appce. Nestačí kontrolovat začátek řetězce —
// prohlížeč z URL vyhodí tabulátory a konce řádků, takže z "/\t/evil.com" udělá "//evil.com"
// (jiný web). Proto adresu nechat naparsovat stejně jako prohlížeč a porovnat origin.
export function SafeRedirect(target: string | null, origin: string, fallback = "/files/") {
  if (!target?.startsWith("/")) return fallback;
  try {
    const url = new URL(target, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
