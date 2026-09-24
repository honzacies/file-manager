// navigator.clipboard existuje jen na HTTPS / localhost. Na http://192.168.x.x
// (LAN, Tailscale bez HTTPS) se kopíruje přes skrytý textarea a execCommand.
export async function CopyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export const ShareUrl = (token: string) => `${window.location.origin}/share/?t=${token}`;
