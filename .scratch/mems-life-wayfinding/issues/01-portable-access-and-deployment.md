# Portable access and deployment

Type: research
Status: resolved
Blocked by: None

## Question

Which concrete service, authentication, and portable deployment approach best fits one person's private installation with web, Expo mobile, generic authenticated MCP clients, PostgreSQL, and independent open-source installations? Compare credible alternatives using current primary sources. Decide how human sign-in and agent credentials differ, without selecting an agent runtime or buying infrastructure.

## Resolution criteria

- Choose a practical initial server/authentication approach, including mobile and browser sessions and scoped revocable agent access.
- Distinguish human sessions, optional OAuth interoperability, and explicit manually configured MCP credentials; never imply universal client compatibility.
- Define local development, self-hosted deployment, external secret setup, and the highest useful test boundary.
- Identify true external prerequisites separately from product requirements; they must not block writing a buildable spec.

## Comments

## Answer

Choose a Node.js 24 LTS / TypeScript / Fastify service with PostgreSQL and embedded Better Auth; deploy the app and database with Compose behind Caddy. Use one locally bootstrapped owner, disabled public signup, and local administrator password/session recovery without requiring SMTP. Browser and Expo clients use revocable human sessions; agents receive separate hashed, scoped, expiring keys with no access to owner credential administration.

Generic authenticated MCP is required through an explicit manually configured authorization-header mode and a real test client. This does not claim OAuth discovery/consent compatibility. A runtime-specific OAuth adapter and external hosting/accounts remain optional integrations, not specification blockers.

The evidence, alternatives, operational prerequisites and clean-install/restore validation boundary are in [the finding](../research/01-access-deployment.md). Decision supported; no unresolved external prerequisite blocks the spec. Implementation must still validate dependency versions, bootstrap/recovery library calls and native cookie forwarding.
