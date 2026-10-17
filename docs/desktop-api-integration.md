# Desktop authentication integration

The desktop app can authenticate and read the signed-in user's organizations.
Report/design publishing, cloning, downloads, compatibility negotiation, image
upload, limits, and synchronization APIs have been removed. Do not retry those
retired endpoints; they return 404. There is no replacement content API yet.

## Device sign-in

Use the configured app origin (production: `https://subtubes.com`).

1. `POST /api/auth/device/code` with JSON
   `{ "client_id": "subtubes-ire-desktop" }`.
2. Open the returned `verification_uri_complete` in the user's browser, or show
   `verification_uri` and `user_code`. The website's `/device` page requires login.
3. Poll `POST /api/auth/device/token` using the returned polling interval and:

   ```json
   {
     "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
     "device_code": "THE_RETURNED_DEVICE_CODE",
     "client_id": "subtubes-ire-desktop"
   }
   ```

4. Handle pending/slow-down responses by respecting the polling interval, and
   stop on denial or expiry. On approval, store the returned `access_token`
   securely in the OS credential store, never logs or source control.
5. Send the session token as an `Authorization` Bearer header on authenticated
   requests. It is a revocable Better Auth session token, not a general-purpose
   GitHub credential.

Browser approval uses `GET /api/auth/device?user_code=...` followed by
`POST /api/auth/device/approve` with `{ "userCode": "..." }`.
These are handled by the website and Better Auth.

## User and organization discovery

`GET /api/v1/me` accepts the Bearer session and returns:

```json
{
  "user": {
    "id": "user-id",
    "name": "Example user",
    "email": "user@example.test",
    "emailVerified": false,
    "image": null,
    "username": null,
    "displayUsername": null
  },
  "organizations": [
    {
      "id": "organization-id",
      "name": "Example workspace",
      "slug": "example-workspace",
      "logo": null,
      "role": "owner",
      "createdAt": "2026-10-17T00:00:00.000Z"
    }
  ]
}
```

Only organizations containing the user are returned, including their personal
workspace. The endpoint sets `Cache-Control: no-store` and supports CORS
preflight for `GET` and the `Authorization`/`Content-Type` headers.

An absent/expired/revoked session returns HTTP 401:

```json
{ "error": "unauthorized", "message": "Authentication required." }
```

Treat 401 as a sign-in requirement rather than an empty organization list.
On logout, `POST /api/auth/sign-out` with the Bearer session and an empty JSON
body revokes that session; subsequent `/api/v1/me` calls return 401.
Never ship the website's database or Blob read-write credentials to the desktop.
