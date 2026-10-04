"use client";

import { Button, Form, Input, Label, TextField, toast } from "@heroui/react";
import { useRef, useState } from "react";
import { Icon } from "@/Components/Icon";
import { LanguageSelect, useLanguage } from "@/Components/Language";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { PasswordField } from "@/Components/PasswordField";
import { type User, useSetUser, useUser } from "@/Components/Session";
import { UserAvatar } from "@/Components/UserAvatar";
import { ApiFetch, ErrorText } from "@/lib/api";
import { CurrentLang, t, type Lang } from "@/lib/i18n";

const AVATAR_SIZE = 256;

// Obrázek -> čtverec 256×256 WebP (oříznutý na střed). Na server jde jen tohle, ne originál z mobilu.
async function ToAvatar(file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("Canvas is not available.", "Canvas není dostupný."));
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t("Conversion failed.", "Převod se nepovedl.")))), "image/webp", 0.85));
}

function ProfilePanel() {
  const user = useUser();
  const setUser = useSetUser();
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Odpověď API je Person bez role — role zůstává z relace.
  const Apply = (person: Omit<User, "role">) => setUser({ ...person, role: user.role });

  async function Save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await ApiFetch<Omit<User, "role">>("/api/account/profile", "PUT", { firstName, lastName });
    setSaving(false);
    if (!result.ok) return toast.danger(ErrorText(result));
    Apply(result.body);
    // Server jméno srovná ("jan novák" -> "Jan Novák"), ukázat výsledek i v polích.
    setFirstName(result.body.firstName ?? "");
    setLastName(result.body.lastName ?? "");
    toast.success(t("Profile saved", "Profil uložen"));
  }

  async function Upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.danger(t("Choose an image (JPG, PNG, WebP…).", "Vyber obrázek (JPG, PNG, WebP…)."));
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", await ToAvatar(file), "avatar.webp");
      const response = await fetch("/api/account/avatar", { method: "POST", body: form, headers: { "X-Lang": CurrentLang() } });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? t("Upload failed.", "Nahrání se nepovedlo."));
      Apply(body);
      toast.success(t("Avatar updated", "Avatar nastaven"));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t("Upload failed.", "Nahrání se nepovedlo."));
    } finally {
      setUploading(false);
    }
  }

  async function RemoveAvatar() {
    const result = await ApiFetch<Omit<User, "role">>("/api/account/avatar", "DELETE");
    if (!result.ok) return toast.danger(ErrorText(result));
    Apply(result.body);
    toast.success(t("Avatar removed", "Avatar odebrán"));
  }

  const changed = firstName !== (user.firstName ?? "") || lastName !== (user.lastName ?? "");

  return (
    <Panel>
      <h2 className="mb-1 font-semibold">{t("Profile", "Profil")}</h2>
      <p className="mb-5 text-sm text-muted">{t("This is how others see you on shared files and folders.", "Takhle tě uvidí ostatní u sdílených souborů a složek.")}</p>

      <div className="mb-6 flex items-center gap-4">
        <UserAvatar person={user} size="lg" className="size-20! text-2xl!" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" isPending={uploading} onPress={() => fileInput.current?.click()}>
              <Icon name="photo_camera" className="text-[18px]" />
              {user.avatar ? t("Change photo", "Změnit fotku") : t("Upload photo", "Nahrát fotku")}
            </Button>
            {user.avatar && (
              <Button size="sm" variant="ghost" onPress={RemoveAvatar} className="text-danger!">
                {t("Remove", "Odebrat")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">{t("Cropped to a centered square.", "Ořízne se na čtverec podle středu.")}</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            Upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <Form onSubmit={Save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField value={firstName} onChange={setFirstName} maxLength={50}>
            <Label>{t("First name", "Jméno")}</Label>
            <Input autoComplete="given-name" />
          </TextField>
          <TextField value={lastName} onChange={setLastName} maxLength={50}>
            <Label>{t("Last name", "Příjmení")}</Label>
            <Input autoComplete="family-name" />
          </TextField>
        </div>
        <p className="-mt-2 text-xs text-muted">
          {t("Without a name, your username is shown:", "Bez jména se zobrazuje přihlašovací jméno")} <b>{user.username}</b>.{" "}
          {t("You still sign in the same way.", "Přihlašuješ se pořád stejně.")}
        </p>
        <Button type="submit" isPending={saving} isDisabled={!changed} className="self-start">
          {t("Save profile", "Uložit profil")}
        </Button>
      </Form>
    </Panel>
  );
}

function LanguagePanel() {
  const user = useUser();
  const setUser = useSetUser();
  const { setPreference } = useLanguage();
  const [pending, setPending] = useState(false);

  async function Change(value: string) {
    const lang = value === "auto" ? null : (value as Lang);
    setPending(true);
    const result = await ApiFetch("/api/account/lang", "PUT", { lang });
    setPending(false);
    if (!result.ok) return toast.danger(ErrorText(result));
    setUser({ ...user, lang });
    // Až po uložení — změna jazyka vykreslí appku znovu.
    setPreference(lang);
  }

  return (
    <Panel>
      <h2 className="mb-1 font-semibold">{t("Language", "Jazyk")}</h2>
      <p className="mb-5 text-sm text-muted">
        {t(
          "Automatic follows your browser's language, or the server's default if your browser prefers neither English nor Czech.",
          "Automaticky = podle jazyka prohlížeče, a když prohlížeč nechce češtinu ani angličtinu, podle výchozího jazyka serveru.",
        )}
      </p>
      <LanguageSelect label={t("App language", "Jazyk aplikace")} value={user.lang ?? "auto"} onChange={Change} auto isDisabled={pending} />
    </Panel>
  );
}

export default function AccountPage() {
  const user = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; again?: string }>({});
  const [pending, setPending] = useState(false);

  async function Submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setErrors({ next: t("The password must be at least 8 characters long.", "Heslo musí mít aspoň 8 znaků.") });
    if (next !== again) return setErrors({ again: t("The passwords don't match.", "Hesla se neshodují.") });
    setErrors({});
    setPending(true);
    const result = await ApiFetch("/api/account/password", "POST", { currentPassword: current, newPassword: next });
    setPending(false);
    if (!result.ok) return setErrors(result.status === 403 ? { current: ErrorText(result) } : { next: ErrorText(result) });
    setCurrent("");
    setNext("");
    setAgain("");
    toast.success(t("Password changed. Your other devices were signed out.", "Heslo změněno. Ostatní zařízení jsou odhlášená."));
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        title={t("Account", "Účet")}
        description={`${t("Signed in as", "Přihlášen jako")} ${user.username} (${user.role === "admin" ? t("administrator", "administrátor") : t("user", "uživatel")}).`}
      />
      <ProfilePanel />
      <LanguagePanel />
      <Panel>
        <h2 className="mb-1 font-semibold">{t("Change password", "Změna hesla")}</h2>
        <p className="mb-5 text-sm text-muted">{t("All your other devices will be signed out.", "Po změně se odhlásí všechna ostatní zařízení.")}</p>
        <Form onSubmit={Submit} className="flex flex-col gap-4">
          {/* skryté jméno — správce hesel pak ví, ke kterému účtu nové heslo uložit */}
          <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
          <PasswordField label={t("Current password", "Současné heslo")} value={current} onChange={setCurrent} autoComplete="current-password" error={errors.current} />
          <PasswordField label={t("New password", "Nové heslo")} value={next} onChange={setNext} autoComplete="new-password" error={errors.next} description={t("At least 8 characters.", "Aspoň 8 znaků.")} />
          <PasswordField label={t("Repeat new password", "Nové heslo znovu")} value={again} onChange={setAgain} autoComplete="new-password" error={errors.again} />
          <Button type="submit" isPending={pending} className="self-start">
            {t("Change password", "Změnit heslo")}
          </Button>
        </Form>
      </Panel>
    </div>
  );
}
