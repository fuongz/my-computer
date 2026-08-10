// The schema itself lives in @fuongz/auth so the API app reads the same
// definitions. This file stays as the app's import point: `#/server/db/schema` is
// what the layout audit polices as server-only, and a bare package specifier is not.
export * from "@fuongz/auth/schema";
