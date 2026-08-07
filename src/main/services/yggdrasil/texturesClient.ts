import { deleteWithAuth, type Fetcher, getJson, putMultipart } from '@main/services/yggdrasil/http';
import type { SkinVariant } from '@shared/contracts/auth';
import { assertPngBuffer, SkinAssetKinds } from '@shared/yggdrasil/png';
import { undashUuid } from '@shared/yggdrasil/uuid';
import { z } from 'zod';

const TexturesEndpoints = {
  lookup: '/textures',
  skin: '/textures/skin',
  cape: '/textures/cape',
} as const;

export const TexturesLookupResponseSchema = z.object({
  skin: z
    .object({
      url: z.string().min(1),
      variant: z.enum(['CLASSIC', 'SLIM']),
    })
    .nullable(),
  cape: z
    .object({
      url: z.string().min(1),
    })
    .nullable(),
});

export type TexturesLookupResponse = z.infer<typeof TexturesLookupResponseSchema>;

export type YggdrasilTexturesClientOptions = {
  readonly apiRoot: string;
  readonly fetch?: Fetcher;
};

// Skin/cape half of the Yggdrasil surface: the auth half (authserver/sessionserver)
// is served by the launcher's own `authApi`, which speaks the Loontail session
// protocol rather than the raw Yggdrasil one.
export class YggdrasilTexturesClient {
  private readonly apiRoot: string;
  private readonly fetcher: Fetcher;

  constructor(options: YggdrasilTexturesClientOptions) {
    this.apiRoot = options.apiRoot.replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getTextures(uuid: string): Promise<TexturesLookupResponse> {
    return getJson({
      fetcher: this.fetcher,
      url: `${this.url(TexturesEndpoints.lookup)}/${undashUuid(uuid)}`,
      schema: TexturesLookupResponseSchema,
    });
  }

  async uploadSkin(input: {
    accessToken: string;
    file: Uint8Array | ArrayBuffer;
    variant?: SkinVariant;
  }): Promise<void> {
    assertPngBuffer(input.file, SkinAssetKinds.SKIN);
    await putMultipart({
      fetcher: this.fetcher,
      url: this.url(TexturesEndpoints.skin),
      accessToken: input.accessToken,
      file: input.file,
      fields: { variant: input.variant ?? 'CLASSIC' },
    });
  }

  async uploadCape(input: { accessToken: string; file: Uint8Array | ArrayBuffer }): Promise<void> {
    assertPngBuffer(input.file, SkinAssetKinds.CAPE);
    await putMultipart({
      fetcher: this.fetcher,
      url: this.url(TexturesEndpoints.cape),
      accessToken: input.accessToken,
      file: input.file,
    });
  }

  async deleteSkin(input: { accessToken: string }): Promise<void> {
    await deleteWithAuth({
      fetcher: this.fetcher,
      url: this.url(TexturesEndpoints.skin),
      accessToken: input.accessToken,
    });
  }

  async deleteCape(input: { accessToken: string }): Promise<void> {
    await deleteWithAuth({
      fetcher: this.fetcher,
      url: this.url(TexturesEndpoints.cape),
      accessToken: input.accessToken,
    });
  }

  private url(endpoint: string): string {
    return `${this.apiRoot}${endpoint}`;
  }
}
