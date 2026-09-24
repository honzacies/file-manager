import Link from "next/link";
import { Brand } from "@/Components/Brand";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-4 text-center">
      <div className="flex flex-col items-center gap-4">
        <Brand large />
        <h1 className="text-2xl font-semibold">Stránka neexistuje</h1>
        <Link href="/files/" className="text-accent hover:underline">
          Zpět na soubory
        </Link>
      </div>
    </div>
  );
}
