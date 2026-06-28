import { Loaders } from '@loontail/minecraft-kit';
import { buildSpecToTargetInput } from '@main/services/minecraft/target';
import type { BuildSpec } from '@shared/contracts/catalog';
import { LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it } from 'vitest';

const baseSpec = (overrides: Partial<BuildSpec> = {}): BuildSpec => ({
  minecraftVersion: '1.20.1',
  ...overrides,
});

const buildInput = (spec: BuildSpec) =>
  buildSpecToTargetInput({
    targetId: 'target-id',
    spec,
    clientFolder: 'Z:/clients/test',
    runtimeRoot: 'Z:/runtimes',
    loader: LoaderChoices.VANILLA,
  });

describe('buildSpecToTargetInput runtime component', () => {
  it('drops a numeric runtimeVersion so the kit falls back to the manifest default', () => {
    const result = buildInput(baseSpec({ runtimeVersion: '25' }));

    expect(result.runtime).not.toHaveProperty('component');
    expect(result.runtime?.installRoot).toBe('Z:/runtimes');
  });

  it('passes a real Mojang component name through as the override', () => {
    const result = buildInput(baseSpec({ runtimeVersion: 'java-runtime-delta' }));

    expect(result.runtime?.component).toBe('java-runtime-delta');
  });

  it('drops an empty or undefined runtimeVersion', () => {
    expect(buildInput(baseSpec({ runtimeVersion: '   ' })).runtime).not.toHaveProperty('component');
    expect(buildInput(baseSpec({ runtimeVersion: null })).runtime).not.toHaveProperty('component');
    expect(buildInput(baseSpec()).runtime).not.toHaveProperty('component');
  });

  it('keeps the vanilla loader and minecraft version from the spec', () => {
    const result = buildInput(baseSpec({ runtimeVersion: 'jre-legacy' }));

    expect(result.loader).toEqual({ type: Loaders.VANILLA });
    expect(result.minecraft.version).toBe('1.20.1');
    expect(result.runtime?.component).toBe('jre-legacy');
  });
});
