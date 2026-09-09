#!/usr/bin/env bun
// Prints a runner registration (or removal) token minted with the GitHub App's credentials.
import { installationPath, mintInstallationToken, type InstallationTarget } from "../src/app-token";
import { readJson, runnerTokenSchema } from "../src/github-api";

const kind = process.argv[2] === "remove" ? "remove-token" : "registration-token";
const appId = process.env.APP_ID ?? "";
const pem = await Bun.file(process.env.APP_PRIVATE_KEY_PATH ?? "").text();
const target: InstallationTarget = process.env.ORG
  ? { org: process.env.ORG }
  : { repo: process.env.REPO ?? "" };

const token = await mintInstallationToken(appId, pem, target);
const res = await fetch(
  `https://api.github.com/${installationPath(target)}/actions/runners/${kind}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  },
);
const minted = await readJson(res, runnerTokenSchema, `minting ${kind}`);

process.stdout.write(minted.token);
