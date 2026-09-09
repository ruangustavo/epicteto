#!/usr/bin/env bun
// Prints a runner registration (or removal) token minted with the GitHub App's credentials.
import { signAppJwt } from "../src/app-token";

const kind = process.argv[2] === "remove" ? "remove-token" : "registration-token";
const appId = process.env.APP_ID ?? "";
const pem = await Bun.file(process.env.APP_PRIVATE_KEY_PATH ?? "").text();
const jwt = signAppJwt(appId, pem);
const headers = {
  Authorization: `Bearer ${jwt}`,
  Accept: "application/vnd.github+json",
};

const target = process.env.ORG ? `orgs/${process.env.ORG}` : `repos/${process.env.REPO}`;
const installRes = await fetch(
  `https://api.github.com/${process.env.ORG ? `orgs/${process.env.ORG}/installation` : `repos/${process.env.REPO}/installation`}`,
  { headers },
);

if (!installRes.ok) throw new Error(`App is not installed on ${target} (${installRes.status})`);

const { id } = (await installRes.json()) as { id: number };
const tokenRes = await fetch(`https://api.github.com/app/installations/${id}/access_tokens`, {
  method: "POST",
  headers,
});
const { token } = (await tokenRes.json()) as { token: string };

const res = await fetch(`https://api.github.com/${target}/actions/runners/${kind}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  },
});

if (!res.ok) throw new Error(`could not mint ${kind}: ${res.status} ${await res.text()}`);

process.stdout.write(((await res.json()) as { token: string }).token);
