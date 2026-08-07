import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';
import { z } from 'zod';

export type Fetcher = typeof fetch;

// A failing Yggdrasil endpoint answers with this envelope, but an edge proxy in
// front of it answers with HTML. Parse before attaching so only a real protocol
// error body ends up in the error context.
const YggdrasilErrorBodySchema = z.object({
  error: z.string().min(1),
  errorMessage: z.string().min(1),
  cause: z.string().optional(),
});

const runFetch = async (url: string, op: () => Promise<Response>): Promise<Response> => {
  let response: Response;
  try {
    response = await op();
  } catch (err) {
    throw new YggdrasilError(YggdrasilErrorCodes.NETWORK, `Network request failed: ${url}`, {
      cause: err,
      context: { url },
    });
  }
  if (response.ok) return response;
  const body = await readJsonSafe(response);
  const parsedBody = YggdrasilErrorBodySchema.safeParse(body);
  throw new YggdrasilError(
    YggdrasilErrorCodes.HTTP_ERROR,
    `Yggdrasil request failed: ${response.status} ${url}`,
    {
      context: {
        status: response.status,
        url,
        ...(parsedBody.success ? { body: parsedBody.data } : {}),
      },
    },
  );
};

const readJsonSafe = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const getJson = async <T>(opts: {
  fetcher: Fetcher;
  url: string;
  schema: z.ZodType<T>;
}): Promise<T> => {
  const response = await runFetch(opts.url, () =>
    opts.fetcher(opts.url, { method: 'GET', headers: { accept: 'application/json' } }),
  );
  const parsed = opts.schema.safeParse(await readJsonSafe(response));
  if (!parsed.success) {
    throw new YggdrasilError(
      YggdrasilErrorCodes.INVALID_RESPONSE,
      `Yggdrasil response failed schema validation: ${opts.url}`,
      { context: { url: opts.url, status: response.status }, cause: parsed.error },
    );
  }
  return parsed.data;
};

export const putMultipart = async (opts: {
  fetcher: Fetcher;
  url: string;
  accessToken: string;
  file: Uint8Array | ArrayBuffer;
  fields?: Readonly<Record<string, string>>;
}): Promise<void> => {
  const form = new FormData();
  const view = opts.file instanceof Uint8Array ? opts.file : new Uint8Array(opts.file);
  // fetch sets the multipart boundary itself when given FormData — don't override Content-Type.
  // The .slice() detaches the view so the Blob works on both undici (Node) and the browser.
  const blob = new Blob([view.slice().buffer], { type: 'image/png' });
  form.append('file', blob, 'asset.png');
  if (opts.fields) {
    for (const [k, v] of Object.entries(opts.fields)) form.append(k, v);
  }
  await runFetch(opts.url, () =>
    opts.fetcher(opts.url, {
      method: 'PUT',
      headers: { accept: 'application/json', authorization: `Bearer ${opts.accessToken}` },
      body: form,
    }),
  );
};

export const deleteWithAuth = async (opts: {
  fetcher: Fetcher;
  url: string;
  accessToken: string;
}): Promise<void> => {
  await runFetch(opts.url, () =>
    opts.fetcher(opts.url, {
      method: 'DELETE',
      headers: { accept: 'application/json', authorization: `Bearer ${opts.accessToken}` },
    }),
  );
};
