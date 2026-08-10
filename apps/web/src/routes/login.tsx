import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";
import { getSession } from "#/server/auth";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#/components/ui/card";

export const Route = createFileRoute("/login")({
  beforeLoad: async (): Promise<void> => {
    if (await getSession()) throw redirect({ to: "/generations" });
  },
  component: Login,
});

function Login() {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6"><Card><CardHeader><CardTitle>Sign in to Fuongz</CardTitle><CardDescription>Use GitHub to manage your personal API keys.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Your generated assets and tools stay private to your account.</p></CardContent><CardFooter><Button className="w-full" onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/settings/api-keys" })}>Continue with GitHub</Button></CardFooter></Card></main>;
}
