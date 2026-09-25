"use client";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Brand } from "@/Components/Brand";
import { Panel } from "@/Components/Panel";
import { ApiFetch, ErrorText } from "@/lib/api";
import { SafeRedirect } from "@/lib/safeRedirect";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function Submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await ApiFetch("/api/auth/login", "POST", { username, password });
    if (!result.ok) {
      setError(result.status === 429 ? "Moc pokusů. Zkus to za minutu." : ErrorText(result));
      setPending(false);
      return;
    }
    router.replace(SafeRedirect(searchParams.get("from"), window.location.origin));
  }

  return (
    <Form onSubmit={Submit} className="flex flex-col gap-5">
      <TextField name="username" value={username} onChange={setUsername} isRequired autoFocus>
        <Label>Uživatelské jméno</Label>
        <Input autoComplete="username" />
      </TextField>
      <TextField name="password" type="password" value={password} onChange={setPassword} isRequired isInvalid={!!error}>
        <Label>Heslo</Label>
        <Input autoComplete="current-password" />
        {error && <FieldError>{error}</FieldError>}
      </TextField>
      <Button type="submit" isPending={pending} fullWidth>
        Přihlásit se
      </Button>
    </Form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Panel className="w-full max-w-sm p-8!">
        <div className="mb-6 flex flex-col gap-2">
          <Brand large />
          <p className="text-sm text-muted">Přihlas se ke svým souborům.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-xs text-muted">Účet ti založí administrátor.</p>
      </Panel>
    </div>
  );
}
