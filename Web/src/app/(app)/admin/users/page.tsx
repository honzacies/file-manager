"use client";

import { Button, Chip, Form, Input, type Key, Label, ListBox, Select, TextField, toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { AdminOnly } from "@/Components/AdminOnly";
import { AppDialog } from "@/Components/AppDialog";
import { MoreButton } from "@/Components/Files/ActionMenu";
import { Icon } from "@/Components/Icon";
import { PageHeader } from "@/Components/PageHeader";
import { PasswordField } from "@/Components/PasswordField";
import { useUser } from "@/Components/Session";
import { QuotaField } from "@/Components/QuotaField";
import { ErrorView, LoadingRows } from "@/Components/StateViews";
import { type Person, UserAvatar } from "@/Components/UserAvatar";
import { ApiFetch, ErrorText } from "@/lib/api";
import { FormatBytes, FormatDate } from "@/lib/format";
import { ListPanel } from "@/Components/ListPanel";
import { t } from "@/lib/i18n";

interface UserRow {
  id: number;
  username: string;
  role: "admin" | "user";
  createdAt: number;
  quotaBytes: number | null;
  usedBytes: number;
  person: Person;
}

type DialogState =
  | { kind: "create" }
  | { kind: "password"; user: UserRow }
  | { kind: "delete"; user: UserRow }
  | { kind: "quota"; user: UserRow }
  | null;

function RoleSelect({ value, onChange }: { value: Key | null; onChange: (value: Key | null) => void }) {
  return (
    <Select value={value} onChange={onChange} className="w-full">
      <Label>Role</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="user" textValue={t("User", "Uživatel")}>
            {t("User: sees only their own files", "Uživatel — vidí jen svoje soubory")}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="admin" textValue={t("Administrator", "Administrátor")}>
            {t("Administrator: sees everything and manages the server", "Administrátor — vidí vše a spravuje server")}
            <ListBox.ItemIndicator />
          </ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

// Jeden formulář pro založení, reset hesla i smazání — liší se jen poli.
function UserDialog({ state, onClose, onDone }: { state: DialogState; onClose: () => void; onDone: (message: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Key | null>("user");
  const [ownPassword, setOwnPassword] = useState("");
  const [quota, setQuota] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setUsername("");
    setPassword("");
    setRole("user");
    setOwnPassword("");
    setQuota(state?.kind === "quota" ? state.user.quotaBytes : null);
    setError(null);
  }, [state]);

  if (!state) return null;
  const target = state.kind === "create" ? null : state.user;

  async function Submit(event: React.FormEvent) {
    event.preventDefault();
    if (!state) return;
    if ((state.kind === "create" || state.kind === "password") && password.length < 8) return setError(t("The password must be at least 8 characters long.", "Heslo musí mít aspoň 8 znaků."));
    setPending(true);
    const result =
      state.kind === "create"
        ? await ApiFetch("/api/admin/users", "POST", { username: username.trim(), password, role, quotaBytes: quota })
        : state.kind === "password"
          ? await ApiFetch(`/api/admin/users/${state.user.id}`, "PATCH", { newPassword: password, currentPassword: ownPassword })
          : state.kind === "quota"
            ? await ApiFetch(`/api/admin/users/${state.user.id}`, "PATCH", { quotaBytes: quota })
            : await ApiFetch(`/api/admin/users/${state.user.id}`, "DELETE", { currentPassword: ownPassword });
    setPending(false);
    if (!result.ok) {
      const invalidUsername = result.status === 400 && state.kind === "create";
      return setError(invalidUsername ? t("Usernames are 2–32 characters: letters without accents, digits, _ . -", "Jméno smí mít 2–32 znaků: písmena bez diakritiky, číslice, _ . -") : ErrorText(result));
    }
    onDone(
      state.kind === "create"
        ? t(`User ${username.trim()} created`, `Uživatel ${username.trim()} založen`)
        : state.kind === "password"
          ? t(`Password for ${target?.username} changed`, `Heslo pro ${target?.username} změněno`)
          : state.kind === "quota"
            ? quota === null
              ? t(`Quota for ${target?.username} removed`, `Kvóta pro ${target?.username} zrušena`)
              : t(`Quota for ${target?.username} set to ${FormatBytes(quota)}`, `Kvóta pro ${target?.username} nastavena na ${FormatBytes(quota)}`)
            : t(`Account ${target?.username} deleted`, `Účet ${target?.username} smazán`),
    );
  }

  const titles = {
    create: t("New user", "Nový uživatel"),
    password: t(`New password for ${target?.username}`, `Nové heslo pro ${target?.username}`),
    delete: t(`Delete account ${target?.username}?`, `Smazat účet ${target?.username}?`),
    quota: t(`Quota for ${target?.username}`, `Kvóta pro ${target?.username}`),
  };

  return (
    <AppDialog isOpen onOpenChange={(open) => !open && onClose()} title={titles[state.kind]} size="sm" isDismissable={!pending}>
      <Form onSubmit={Submit} className="flex flex-col gap-4">
        {state.kind === "create" && (
          <>
            <TextField value={username} onChange={setUsername} isRequired autoFocus>
              <Label>{t("Username", "Uživatelské jméno")}</Label>
              {/* off: pole nese jméno NĚKOHO JINÉHO, prohlížeč by nabízel adminovo */}
              <Input autoComplete="off" />
            </TextField>
            <PasswordField label={t("Password", "Heslo")} value={password} onChange={setPassword} autoComplete="new-password" description={t("At least 8 characters.", "Aspoň 8 znaků.")} />
            <RoleSelect value={role} onChange={setRole} />
            <QuotaField bytes={quota} onChange={setQuota} />
          </>
        )}
        {state.kind === "quota" && (
          <>
            <p className="text-sm text-muted">
              {t(
                `Currently using ${FormatBytes(target?.usedBytes ?? 0)}. A lower limit deletes nothing, it just blocks further uploads.`,
                `Teď má obsazeno ${FormatBytes(target?.usedBytes ?? 0)}. Nižší limit nic nesmaže, jen zablokuje další nahrávání.`,
              )}
            </p>
            <QuotaField bytes={quota} onChange={setQuota} autoFocus />
          </>
        )}
        {state.kind === "password" && (
          <PasswordField label={t("New password", "Nové heslo")} value={password} onChange={setPassword} autoComplete="new-password" description={t("At least 8 characters.", "Aspoň 8 znaků.")} autoFocus />
        )}
        {state.kind === "delete" && (
          <p className="text-sm text-muted">
            {t("The user can no longer sign in and their public links stop working.", "Uživatel se už nepřihlásí a jeho sdílené odkazy přestanou fungovat.")}{" "}
            <b className="text-foreground">{t("Their files stay on disk", "Soubory na disku zůstanou")}</b> {t("in the folder", "ve složce")} <code>{target?.username}</code>
            {t(", where admins can find them under All files.", ", admin je najde ve Všech souborech.")}
          </p>
        )}
        {(state.kind === "password" || state.kind === "delete") && (
          <PasswordField
            label={t("Your password to confirm", "Tvoje heslo pro potvrzení")}
            value={ownPassword}
            onChange={setOwnPassword}
            autoComplete="current-password"
            autoFocus={state.kind === "delete"}
          />
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="tertiary" onPress={onClose} isDisabled={pending}>
            {t("Cancel", "Zrušit")}
          </Button>
          <Button type="submit" variant={state.kind === "delete" ? "danger" : "primary"} isPending={pending}>
            {{ create: t("Create", "Založit"), password: t("Change password", "Změnit heslo"), quota: t("Save", "Uložit"), delete: t("Delete account", "Smazat účet") }[state.kind]}
          </Button>
        </div>
      </Form>
    </AppDialog>
  );
}

export default function UsersPage() {
  const me = useUser();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const Load = useCallback(() => {
    setError(null);
    ApiFetch<UserRow[]>("/api/admin/users").then((result) => (result.ok ? setUsers(result.body) : setError(ErrorText(result))));
  }, []);
  useEffect(Load, [Load]);

  async function ToggleRole(user: UserRow) {
    const role = user.role === "admin" ? "user" : "admin";
    const result = await ApiFetch(`/api/admin/users/${user.id}`, "PATCH", { role });
    if (result.ok) toast.success(
        role === "admin"
          ? t(`${user.username} is now an administrator`, `${user.username} je teď administrátor`)
          : t(`${user.username} is no longer an administrator`, `${user.username} už není administrátor`),
      );
    else toast.danger(ErrorText(result));
    Load();
  }

  return (
    <AdminOnly>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("Users", "Uživatelé")}
          description={t("Each user has their own folder and sees only their own files.", "Každý uživatel má vlastní složku a vidí jen svoje soubory.")}
          actions={
            <Button onPress={() => setDialog({ kind: "create" })}>
              <Icon name="person_add" className="text-[18px]" />
              {t("Add user", "Přidat uživatele")}
            </Button>
          }
        />

        {error ? (
          <ErrorView message={error} onRetry={Load} />
        ) : !users ? (
          <LoadingRows count={3} />
        ) : (
          <ListPanel>
              {users.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-3 py-2.5">
                  <UserAvatar person={user.person} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.person.name}
                      {user.person.name !== user.username && <span className="font-normal text-muted"> · {user.username}</span>}
                      {user.id === me.id && <span className="font-normal text-muted"> ({t("you", "ty")})</span>}
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      {user.quotaBytes === null
                        ? `${FormatBytes(user.usedBytes)} · ${t("no limit", "bez limitu")}`
                        : `${FormatBytes(user.usedBytes)} ${t("of", "z")} ${FormatBytes(user.quotaBytes)}`}
                      {" · "}
                      {t("created", "založen")} {FormatDate(user.createdAt)}
                    </p>
                  </div>
                  <Chip size="sm" variant="soft" color={user.role === "admin" ? "accent" : "default"}>
                    {user.role === "admin" ? t("Administrator", "Administrátor") : t("User", "Uživatel")}
                  </Chip>
                  <MoreButton
                    label={`${t("Actions for", "Akce pro")} ${user.username}`}
                    actions={[
                      { id: "role", label: user.role === "admin" ? t("Remove admin rights", "Odebrat práva admina") : t("Make administrator", "Udělat administrátorem"), icon: "shield_person" },
                      { id: "password", label: t("Set new password", "Nastavit nové heslo"), icon: "key" },
                      { id: "quota", label: t("Set quota", "Nastavit kvótu"), icon: "data_usage" },
                      ...(user.id === me.id ? [] : [{ id: "delete", label: t("Delete account", "Smazat účet"), icon: "person_remove", danger: true, separated: true }]),
                    ]}
                    onAction={(id) => (id === "role" ? ToggleRole(user) : setDialog({ kind: id as "password" | "delete" | "quota", user }))}
                  />
                </li>
              ))}
            </ListPanel>
        )}

        <UserDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            toast.success(message);
            Load();
          }}
        />
      </div>
    </AdminOnly>
  );
}
