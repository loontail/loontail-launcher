import path from 'node:path';
import { isUnderClientsRoot } from '@main/services/minecraft/uninstall';
import { describe, expect, it } from 'vitest';

// isUnderClientsRoot is the only guard before `fs.rm(folder, { recursive: true })`
// in runUninstall, so a regression here would be a P0 user-data-loss bug.
describe('isUnderClientsRoot', () => {
  describe('empty / blank inputs', () => {
    it('rejects an empty folder', () => {
      expect(isUnderClientsRoot('', '/clients')).toBe(false);
    });

    it('rejects an empty clientsRoot', () => {
      expect(isUnderClientsRoot('/clients/survival', '')).toBe(false);
    });

    it('rejects both empty', () => {
      expect(isUnderClientsRoot('', '')).toBe(false);
    });
  });

  describe('identity and parent', () => {
    it('rejects the root itself (relative is empty string)', () => {
      const root = path.resolve('/clients');
      expect(isUnderClientsRoot(root, root)).toBe(false);
    });

    it('rejects the parent of clientsRoot', () => {
      const root = path.resolve('/clients');
      const parent = path.resolve('/');
      expect(isUnderClientsRoot(parent, root)).toBe(false);
    });
  });

  describe('escapes', () => {
    it('rejects ".." segments that escape clientsRoot', () => {
      const root = path.resolve('/clients');
      const outside = path.join(root, '..', 'etc');
      expect(isUnderClientsRoot(outside, root)).toBe(false);
    });

    it('rejects a sibling directory of clientsRoot', () => {
      const root = path.resolve('/clients');
      const sibling = path.resolve('/other');
      expect(isUnderClientsRoot(sibling, root)).toBe(false);
    });
  });

  describe('absolute / drive-letter handling', () => {
    if (process.platform === 'win32') {
      it('rejects a folder on a different drive letter than clientsRoot', () => {
        expect(isUnderClientsRoot('D:\\survival', 'C:\\clients')).toBe(false);
      });

      it('accepts a child path on the same drive as clientsRoot', () => {
        expect(isUnderClientsRoot('C:\\clients\\survival', 'C:\\clients')).toBe(true);
      });
    } else {
      it('accepts a child path under clientsRoot', () => {
        expect(isUnderClientsRoot('/clients/survival', '/clients')).toBe(true);
      });
    }
  });

  describe('valid children', () => {
    it('accepts a direct child of clientsRoot', () => {
      const root = path.resolve('/clients');
      const child = path.join(root, 'survival');
      expect(isUnderClientsRoot(child, root)).toBe(true);
    });

    it('accepts a nested grandchild', () => {
      const root = path.resolve('/clients');
      const grand = path.join(root, 'survival', 'versions');
      expect(isUnderClientsRoot(grand, root)).toBe(true);
    });
  });
});
