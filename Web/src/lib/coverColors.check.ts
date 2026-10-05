// Barvy z obalu sedí s obalem: `node src/lib/coverColors.check.ts`
import assert from "node:assert/strict";
import { GRAY_PALETTE, PaletteFromPixels } from "./coverColors.ts";

// obal z bloků barev: [r, g, b, podíl pixelů]
function Cover(blocks: [number, number, number, number][]) {
  const pixels: number[] = [];
  for (const [r, g, b, share] of blocks) for (let i = 0; i < share * 1024; i++) pixels.push(r, g, b, 255);
  return pixels;
}
const Hues = (palette: string[]) => palette.map((color) => Number(color.match(/hsl\((\d+)/)?.[1]));

// půl červená, půl modrá → červená a modrá, žádná fialová (průměr by dal ~270°)
const redBlue = Hues(PaletteFromPixels(Cover([[220, 30, 30, 0.5], [30, 60, 220, 0.5]])));
assert.ok(redBlue.some((h) => h < 15 || h > 345), `chybí červená: ${redBlue}`);
assert.ok(redBlue.some((h) => h > 210 && h < 240), `chybí modrá: ${redBlue}`);
assert.ok(!redBlue.some((h) => h > 260 && h < 320), `vymyšlená fialová: ${redBlue}`);

// černý obal s malým růžovým detailem (2 %) a bílými tvářemi → šedá, ne barvy
assert.deepEqual(PaletteFromPixels(Cover([[0, 0, 0, 0.8], [240, 235, 235, 0.18], [230, 150, 170, 0.02]])), GRAY_PALETTE);

// šedomodrý obal (sytost pod 20 %) → šedá, ne vymyšlená sytá modrá
assert.deepEqual(PaletteFromPixels(Cover([[120, 125, 140, 1]])), GRAY_PALETTE);

// jedna barva → 4 odstíny téže barvy
const green = Hues(PaletteFromPixels(Cover([[40, 160, 60, 0.7], [10, 10, 10, 0.3]])));
assert.ok(green.every((h) => h > 110 && h < 150), `jen zelená: ${green}`);

console.log("\x1b[32m✓\x1b[0m barvy z obalu: žádné míchání odstínů, šedé obaly zůstanou šedé");
