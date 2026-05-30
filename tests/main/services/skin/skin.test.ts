import type { MinecraftKit } from '@loontail/minecraft-kit';
import { createSkinHandlers } from '@main/services/skin/skin';
import { ERROR_CODES } from '@shared/constants';
import type { YggdrasilSession } from '@shared/contracts/auth';
import { SkinKinds } from '@shared/contracts/skin';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getStoredAuth: vi.fn(),
  setStoredAuth: vi.fn(),
}));

const yggClientMocks = vi.hoisted(() => ({
  uploadSkin: vi.fn(),
  uploadCape: vi.fn(),
  deleteSkin: vi.fn(),
  deleteCape: vi.fn(),
}));

const fetchTexturesMock = vi.hoisted(() => vi.fn());
const mediaCacheMocks = vi.hoisted(() => ({
  prewarmMediaCache: vi.fn(),
  invalidateMediaCache: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/store', () => ({
  getStoredAuth: storeMocks.getStoredAuth,
  setStoredAuth: storeMocks.setStoredAuth,
}));

vi.mock('@main/services/auth/yggdrasilClient', () => ({
  fetchTextures: fetchTexturesMock,
  getYggdrasilClient: () => yggClientMocks,
}));

vi.mock('@main/services/media/mediaCache', () => ({
  prewarmMediaCache: mediaCacheMocks.prewarmMediaCache,
  invalidateMediaCache: mediaCacheMocks.invalidateMediaCache,
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

vi.mock('@main/services/auth/mojangAuth', () => ({
  withRefreshedProfile: vi.fn(),
}));

vi.mock('@loontail/yggdrasil-core', () => ({
  validatePngBuffer: () => ({ ok: true }),
}));

vi.mock('@loontail/minecraft-kit', () => ({
  detectSkinVariant: () => 'classic',
  isMinecraftKitError: () => false,
}));

const kitStub = {} as unknown as MinecraftKit;

const yggdrasilSession = (token = 'access'): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: token,
  clientToken: 'client',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

const skinPayload = () => ({ type: SkinKinds.SKIN, buffer: new ArrayBuffer(8) });

beforeEach(() => {
  vi.clearAllMocks();
  fetchTexturesMock.mockResolvedValue({ skin: null, cape: null });
  yggClientMocks.uploadSkin.mockResolvedValue(undefined);
  yggClientMocks.uploadCape.mockResolvedValue(undefined);
  yggClientMocks.deleteSkin.mockResolvedValue(undefined);
  yggClientMocks.deleteCape.mockResolvedValue(undefined);
  mediaCacheMocks.prewarmMediaCache.mockResolvedValue(undefined);
  mediaCacheMocks.invalidateMediaCache.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('uploadSkin (yggdrasil)', () => {
  it('retries the post-upload texture lookup until the new URL propagates', async () => {
    vi.useFakeTimers();
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock
      .mockResolvedValueOnce({ skin: null, cape: null })
      .mockResolvedValueOnce({ skin: null, cape: null })
      .mockResolvedValueOnce({ skin: { url: 'https://skins/new' }, cape: null });

    const { uploadSkin } = createSkinHandlers(kitStub);
    const pending = uploadSkin(skinPayload());
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ url: 'https://skins/new' });
    expect(fetchTexturesMock).toHaveBeenCalledTimes(3);
    expect(mediaCacheMocks.prewarmMediaCache).toHaveBeenCalledWith(
      'https://skins/new',
      expect.any(Buffer),
    );
  });

  it('throws when the texture never appears after the retries', async () => {
    vi.useFakeTimers();
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock.mockResolvedValue({ skin: null, cape: null });

    const { uploadSkin } = createSkinHandlers(kitStub);
    const pending = uploadSkin(skinPayload()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;

    expect(error).toMatchObject({ code: ERROR_CODES.SkinUploadFailed });
    expect(mediaCacheMocks.prewarmMediaCache).not.toHaveBeenCalled();
  });
});

describe('clearSkin (yggdrasil)', () => {
  it('invalidates the cache with the absolutised URLs from fetchTextures', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock.mockResolvedValue({
      skin: { url: 'https://api/textures/skin' },
      cape: { url: 'https://api/textures/cape' },
    });

    const { clearSkin } = createSkinHandlers(kitStub);
    await clearSkin();

    expect(fetchTexturesMock).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef');
    expect(mediaCacheMocks.invalidateMediaCache).toHaveBeenCalledWith('https://api/textures/skin');
    expect(mediaCacheMocks.invalidateMediaCache).toHaveBeenCalledWith('https://api/textures/cape');
  });

  it('throws and skips cache invalidation when the server delete fails', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock.mockResolvedValue({ skin: { url: 'https://api/textures/skin' }, cape: null });
    yggClientMocks.deleteSkin.mockRejectedValue(new Error('429 Too Many Requests'));

    const { clearSkin } = createSkinHandlers(kitStub);

    await expect(clearSkin()).rejects.toMatchObject({ code: ERROR_CODES.SkinClearFailed });
    expect(mediaCacheMocks.invalidateMediaCache).not.toHaveBeenCalled();
  });
});
