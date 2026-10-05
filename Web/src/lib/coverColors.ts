// Barvy pro mesh gradient přehrávače z pixelů obalu (RGBA, např. z canvasu 32×32).
// Pixely se třídí do skupin podle odstínu (po 30°) a berou se nejzastoupenější skupiny s jejich průměrnou
// barvou — nikdy se nemíchají různé odstíny (červená vedle modré by zprůměrovaná dala fialovou, která
// na obalu není) a sytost se jen mírně zvedne, ne vymyslí.

export function RgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

// Černobílý / skoro bezbarvý obal: odstíny šedé, dost rozdílné, ať je pohyb vidět.
export const GRAY_PALETTE = ["hsl(0 0% 34%)", "hsl(0 0% 22%)", "hsl(0 0% 46%)", "hsl(0 0% 14%)"];

// Jak se doplní paleta, když má obal méně než 4 výrazné barvy: světlejší a tmavší varianty.
const LIGHTNESS_STEPS = [1, 0.65, 1.3, 0.8];

export function PaletteFromPixels(data: ArrayLike<number>): string[] {
  const groups = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // průhledné
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    total++;
    const [h, s, l] = RgbToHsl(r, g, b);
    // šedé, skoro černé a skoro bílé pixely barvu nenesou (u tmavých je „sytost“ jen šum)
    if (s < 0.2 || l < 0.12 || l > 0.9) continue;
    const key = Math.round(h / 30) % 12;
    const group = groups.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    group.n++;
    group.r += r;
    group.g += g;
    group.b += b;
    groups.set(key, group);
  }
  // barva musí pokrývat aspoň 3 % obalu, jinak je to detail (logo, nápis), ne barva obalu
  const main = [...groups.values()]
    .filter((group) => group.n >= total * 0.03)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((group) => RgbToHsl(group.r / group.n, group.g / group.n, group.b / group.n));
  if (!main.length) return GRAY_PALETTE;
  return LIGHTNESS_STEPS.map((step, i) => {
    const [h, s, l] = main[i] ?? main[i % main.length];
    const lightness = main[i] ? l : l * step;
    return `hsl(${Math.round(h)} ${Math.round(Math.min(1, s * 1.1) * 100)}% ${Math.round(Math.min(0.62, Math.max(0.25, lightness)) * 100)}%)`;
  });
}
