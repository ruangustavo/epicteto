#!/usr/bin/env bun
// Creates the GitHub App through GitHub's manifest flow: serves a form on localhost, you click
// "Create GitHub App" once, and the callback saves APP_ID + private key under ./secrets/.
// Usage: bun run scripts/create-app.ts <app-name> [--org <org>]
import { appManifestConversionSchema, readJson } from "../src/github-api";

const appName = process.argv[2];

if (!appName) {
  console.error("usage: bun run scripts/create-app.ts <app-name> [--org <org>]");
  process.exit(1);
}

const orgIdx = process.argv.indexOf("--org");
const org = orgIdx > 0 ? process.argv[orgIdx + 1] : null;
const PORT = 8765;
const manifest = {
  name: appName,
  url: "https://github.com/ruangustavo/epicteto",
  redirect_url: `http://localhost:${PORT}/callback`,
  public: false,
  default_permissions: {
    contents: "write",
    pull_requests: "write",
    issues: "write",
    metadata: "read",
    administration: "write",
  },
  default_events: [],
};
const target = org
  ? `https://github.com/organizations/${org}/settings/apps/new`
  : "https://github.com/settings/apps/new";

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      const json = JSON.stringify(manifest).replace(/"/g, "&quot;");

      return new Response(
        `<html><body onload="document.forms[0].submit()"><form action="${target}?state=epicteto" method="post">
         <input type="hidden" name="manifest" value="${json}"><noscript><button>Create GitHub App</button></noscript></form>
         Redirecting to GitHub…</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");

      if (!code) return new Response("missing code", { status: 400 });

      const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json" },
      });
      const app = await readJson(res, appManifestConversionSchema, "App manifest conversion");

      await Bun.$`mkdir -p secrets && chmod 700 secrets`;
      await Bun.write("secrets/app-private-key.pem", app.pem);
      await Bun.$`chmod 600 secrets/app-private-key.pem`;
      console.log(`\nApp created: ${app.html_url}`);
      console.log(`APP_ID=${app.id}`);
      console.log(`EPICTETO_BOT=${app.slug}[bot]`);
      console.log(`Private key: secrets/app-private-key.pem`);
      console.log(`\nNext: install it on your repo → ${app.html_url}/installations/new`);
      setTimeout(() => process.exit(0), 300);

      return new Response(`App "${app.slug}" created. Back to the terminal.`, {
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response("not found", { status: 404 });
  },
});
console.log(`Open http://localhost:${PORT}/ and click "Create GitHub App".`);
