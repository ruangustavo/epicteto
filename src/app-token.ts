import { createSign } from "node:crypto";

/** Mints a GitHub App installation token from the App id and private key. */
export async function mintInstallationToken(
  appId: string,
  privateKeyPem: string,
  repo: string,
): Promise<string> {
  const jwt = signAppJwt(appId, privateKeyPem);
  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
  };
  const installRes = await fetch(`https://api.github.com/repos/${repo}/installation`, { headers });

  if (!installRes.ok) throw new Error(`App is not installed on ${repo} (${installRes.status})`);

  const { id } = (await installRes.json()) as { id: number };
  const tokenRes = await fetch(`https://api.github.com/app/installations/${id}/access_tokens`, {
    method: "POST",
    headers,
  });

  if (!tokenRes.ok) throw new Error(`could not mint installation token (${tokenRes.status})`);

  return ((await tokenRes.json()) as { token: string }).token;
}

export function signAppJwt(appId: string, privateKeyPem: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({
    alg: "RS256",
    typ: "JWT",
  })}.${b64({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(privateKeyPem).toString("base64url");

  return `${unsigned}.${sig}`;
}

export async function fetchAppSlug(appId: string, privateKeyPem: string): Promise<string> {
  const res = await fetch("https://api.github.com/app", {
    headers: {
      Authorization: `Bearer ${signAppJwt(appId, privateKeyPem)}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) throw new Error(`could not read App metadata (${res.status})`);

  return ((await res.json()) as { slug: string }).slug;
}
