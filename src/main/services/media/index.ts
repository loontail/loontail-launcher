import { CACHE_SCHEME, registerMediaProtocol } from './protocol';

export { CACHE_SCHEME };

export type MediaService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createMediaService = (): MediaService => ({
  init: async () => {
    registerMediaProtocol();
  },
  dispose: async () => {},
});
