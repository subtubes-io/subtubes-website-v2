import { createAuthClient } from "better-auth/react";
import { deviceAuthorizationClient, organizationClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient(), deviceAuthorizationClient(), usernameClient()],
});
