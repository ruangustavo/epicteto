import { createSign } from "node:crypto";
import { accessTokenSchema, appSchema, installationSchema, readJson } from "./github-api";

/** Where the App is installed: a repository or an organization. */
export type InstallationTarget = { repo: string } | { org: string };

export function installationPath(target: InstallationTarget): string {
  return "org" in target ? `orgs/${target.org}` : `repos/${target.repo}`;
}

function appHeaders(appId: string, privateKeyPem: string) {
  return {
    Authorization: `Bearer ${signAppJwt(appId, privateKeyPem)}`,
    Accept: "application/vnd.github+json",
  };
}

/** Mints a GitHub App installation token for the target the App is installed on. */
export async function mintInstallationToken(
  appId: string,
  privateKeyPem: string,
  target: InstallationTarget,
): Promise<string> {
  const headers = appHeaders(appId, privateKeyPem);
  const path = installationPath(target);
  const { id } = await readJson(
    await fetch(`https://api.github.com/${path}/installation`, { headers }),
    installationSchema,
    `App installation lookup on ${path}`,
  );
  const { token } = await readJson(
    await fetch(`https://api.github.com/app/installations/${id}/access_tokens`, {
      method: "POST",
      headers,
    }),
    accessTokenSchema,
    "installation token",
  );

  return token;
}

export async function fetchAppSlug(appId: string, privateKeyPem: string): Promise<string> {
  const { slug } = await readJson(
    await fetch("https://api.github.com/app", { headers: appHeaders(appId, privateKeyPem) }),
    appSchema,
    "App metadata",
  );

  return slug;
}

interface JwtHeader {
  alg: "RS256";
  typ: "JWT";
}

interface JwtClaims {
  iat: number;
  exp: number;
  iss: string;
}

export function signAppJwt(appId: string, privateKeyPem: string): string {
  const b64 = (part: JwtHeader | JwtClaims) =>
    Buffer.from(JSON.stringify(part)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = {
    alg: "RS256",
    typ: "JWT",
  };
  const claims: JwtClaims = {
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  };
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(privateKeyPem).toString("base64url");

  return `${unsigned}.${sig}`;
}
