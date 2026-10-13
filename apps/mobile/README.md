# Native client

This foundation connects iPhone and iPad to the same private owner account as the web client. It supports owner sign-in, installation-specific secure credentials, persisted profile preferences, appearance and unit settings, and server session sign-out. Tasks, Workouts, Food, and Today show clearly labelled planned states until their implementation tickets land.

Run commands from the repository root after `npm ci` and the domain build.

```sh
npm run start --workspace @mems-life/mobile
npm run typecheck --workspace @mems-life/mobile
npm run test --workspace @mems-life/mobile
npm run bundle:ios --workspace @mems-life/mobile
```

Enter the installation's HTTPS origin at sign-in. The address must not contain credentials or a path. `EXPO_PUBLIC_API_URL` may prefill this public address. Never put a password, token, or private secret in an `EXPO_PUBLIC_*` variable. A loopback HTTP address such as `http://localhost:3001` is permitted only for simulator development. A physical device needs an accessible HTTPS installation.

Owner provisioning and recovery happen on the service. Public signup is disabled. The client does not contain an owner account, password, or sample personal records.

The Better Auth Expo integration stores session cookies in the operating system's secure storage. Each installation origin has its own storage prefix. Custom API calls attach the session cookie explicitly. Mutations include the trusted native `memslife://` origin, which the service must permit. The application rechecks the owner on launch and foreground; it does not treat a cached session as authorization.

Preference writes include an operation ID and expected saved version. A retry after a lost response reuses that operation ID while the form remains open. Conflicts preserve the draft. Checking saved preferences displays the saved values and requires an explicit choice before editing can be resubmitted. Leaving an unsaved form through sign-out asks the person to discard their edits. Drafts remain available across tab changes and signing in again after session expiry while the app remains open. This foundation does not promise offline preference writes or draft persistence after app termination.

On compact displays, five bottom tabs expose the product areas. At 760 points and wider, a persistent sidebar uses the additional space. Text scales with the system, fields have accessible labels, selection controls expose checked state, and primary touch controls are at least 48 points tall.

Native compilation, simulator journeys, physical devices, camera behavior, signing, and release distribution require their own recorded verification. JavaScript export and mocked component tests do not prove those gates.
