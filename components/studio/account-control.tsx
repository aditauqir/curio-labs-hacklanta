"use client";

import { useEffect, useState, type FormEvent } from "react";

type Profile = { username: string; hasPassword: boolean };

export function AccountControl() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("Checking account...");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          authenticated?: boolean;
          profile?: Profile;
        } | null;
        if (response.ok && body?.authenticated && body.profile) {
          setProfile(body.profile);
          setMessage("");
        } else if (response.status === 503) {
          setMessage("Accounts are unavailable");
        } else {
          setMessage("");
        }
      })
      .catch(() => setMessage("Accounts are unavailable"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, username, password }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage(
          body?.error === "username_taken"
            ? "That username is already taken"
            : body?.error === "invalid_credentials"
              ? "Invalid username or password"
              : "Could not save the account",
        );
        return;
      }
      window.location.reload();
    } catch {
      setMessage("Accounts are unavailable");
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    setPending(true);
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    window.location.reload();
  }

  if (profile) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="max-w-28 truncate" title={profile.username}>
          {profile.username}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={pending}
          className="rounded-md border border-line px-2 py-1.5 hover:border-ink hover:text-ink disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-line px-3 py-2 text-xs font-medium text-muted hover:border-ink hover:text-ink">
        {mode === "login" ? "Sign in" : "Create account"}
      </summary>
      <form
        onSubmit={submit}
        className="absolute right-0 z-10 mt-2 grid w-64 gap-3 rounded-lg border border-line bg-panel p-4 shadow-lg"
      >
        <p className="text-xs text-muted">Your workspace, chat, files, and assets follow your account.</p>
        <label className="grid gap-1 text-xs text-muted">
          Username
          <input
            required
            minLength={2}
            maxLength={80}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="rounded-md border border-line bg-paper px-2.5 py-2 text-sm text-ink"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Password
          <input
            required
            minLength={8}
            maxLength={200}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-line bg-paper px-2.5 py-2 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-3 py-2 text-xs font-medium text-paper disabled:opacity-50"
        >
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="text-left text-xs text-muted underline hover:text-ink"
        >
          {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
        {message ? <p role="status" className="text-xs text-muted">{message}</p> : null}
      </form>
    </details>
  );
}
