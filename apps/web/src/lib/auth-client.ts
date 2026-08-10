import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({ plugins: [apiKeyClient()] });
