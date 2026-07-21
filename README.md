# Sufficit Identity UI

Blazor Server frontend for the [Sufficit Identity STS](https://github.com/sufficit/sufficit-identity)
(OpenIddict). Provides the interactive OAuth/OIDC screens: login, consent, logout,
device flow verification, and a full self-service "Manage" area.

## Status

🚧 **Early stage** — actively in development.

## Design goals

- **Blazor Server**, hosted inside the STS app (same origin) for maximum security.
- **Minimal coupling**: references only `Sufficit.Identity.Core` (entities) and
  OpenIddict/Identity abstractions. Does NOT reference the STS host or server
  configuration projects.
- **Injectable** via a single `AddSufficitIdentityUI()` / `UseSufficitIdentityUI()`
  pair, so any OpenIddict-based STS that wires standard ASP.NET Core Identity can
  plug it in.
- **MIT-0 licensed** — free for any use, no attribution required.

## How to inject into the STS host

```csharp
// In sufficit-identity/src/sts/Program.cs:
builder.Services.AddSufficitIdentitySTS(builder.Configuration);
builder.Services.AddSufficitIdentityUI();   // <-- add this

// pipeline:
app.UseAuthentication();
app.UseAuthorization();
app.UseSufficitIdentityUI();                // <-- and this
```

Project reference in `Sufficit.Identity.STS.csproj`:
```xml
<ProjectReference Include="..\..\sufficit-identity-ui\src\Sufficit.Identity.UI\Sufficit.Identity.UI.csproj" />
```

## Screens

- `/Account/Login` — username/password + external login buttons
- `/Consent` — scope-by-scope accept/deny
- `/Account/Logout` — confirmation with client info from `id_token_hint`
- `/Device/UserCode` — device flow user_code capture
- `/Manage/*` — profile, change password, 2FA (TOTP + recovery codes), passkeys,
  external logins, grants, server-side sessions, personal data (GDPR)

## Why Blazor Server (not a JS SPA)

Tokens and credentials never reach the browser: the auth cookie is issued
server-side via `SignInAsync`, the cookie is `HttpOnly + SameSite=Lax`, and
antiforgery is built-in. Hosting on the same origin as the STS removes every
CORS / cross-origin cookie problem. See `docs/architecture.md`.

## License

[MIT-0](./LICENSE).
