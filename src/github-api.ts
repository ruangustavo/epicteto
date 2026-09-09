import { z } from "zod";

/** Parses a fetch Response body against a schema, failing loudly at the I/O boundary. */
export async function readJson<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);

  return schema.parse(await res.json());
}

export const installationSchema = z.object({ id: z.number() });

export const accessTokenSchema = z.object({ token: z.string() });

export const appSchema = z.object({ slug: z.string() });

export const assetSchema = z.object({ url: z.string() });

export const runnerTokenSchema = z.object({ token: z.string() });

export const appManifestConversionSchema = z.object({
  id: z.number(),
  slug: z.string(),
  pem: z.string(),
  html_url: z.string(),
});
