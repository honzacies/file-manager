"use client";

import { Button, Form, toast } from "@heroui/react";
import { useState } from "react";
import { PageHeader } from "@/Components/PageHeader";
import { Panel } from "@/Components/Panel";
import { PasswordField } from "@/Components/PasswordField";
import { useUser } from "@/Components/Session";
import { ApiFetch, ErrorText } from "@/lib/api";

export default function AccountPage() {
  const user = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; again?: string }>({});
  const [pending, setPending] = useState(false);

  async function Submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setErrors({ next: "Heslo musí mít aspoň 8 znaků." });
    if (next !== again) return setErrors({ again: "Hesla se neshodují." });
    setErrors({});
    setPending(true);
    const result = await ApiFetch("/api/account/password", "POST", { currentPassword: current, newPassword: next });
    setPending(false);
    if (!result.ok) return setErrors(result.status === 403 ? { current: ErrorText(result) } : { next: ErrorText(result) });
    setCurrent("");
    setNext("");
    setAgain("");
    toast.success("Heslo změněno. Ostatní zařízení jsou odhlášená.");
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title="Účet" description={`Přihlášen jako ${user.username} (${user.role === "admin" ? "administrátor" : "uživatel"}).`} />
      <Panel>
        <h2 className="mb-1 font-semibold">Změna hesla</h2>
        <p className="mb-5 text-sm text-muted">Po změně se odhlásí všechna ostatní zařízení.</p>
        <Form onSubmit={Submit} className="flex flex-col gap-4">
          {/* skryté jméno — správce hesel pak ví, ke kterému účtu nové heslo uložit */}
          <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
          <PasswordField label="Současné heslo" value={current} onChange={setCurrent} autoComplete="current-password" error={errors.current} />
          <PasswordField label="Nové heslo" value={next} onChange={setNext} autoComplete="new-password" error={errors.next} description="Aspoň 8 znaků." />
          <PasswordField label="Nové heslo znovu" value={again} onChange={setAgain} autoComplete="new-password" error={errors.again} />
          <Button type="submit" isPending={pending} className="self-start">
            Změnit heslo
          </Button>
        </Form>
      </Panel>
    </div>
  );
}
