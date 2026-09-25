import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('crawlee', () => ({
  RobotsFile: {
    load: vi.fn(),
  },
}));

import { RobotsFile } from 'crawlee';
import { RobotsResolver } from '../src/robots.ts';

const mockLoad = vi.mocked(RobotsFile.load);
const LOADER = mockLoad as unknown as { mockImplementation: (fn: () => Promise<never>) => void };

beforeEach(() => {
  mockLoad.mockReset();
});

describe('RobotsResolver (§V6, Fase 2)', () => {
  it('bypass → permite sin consultar robots.txt', async () => {
    const resolver = new RobotsResolver({ userAgent: 'ua', bypass: () => true });
    expect(await resolver.allow('https://serp.hub/search')).toBe(true);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('robots.txt permite → true', async () => {
    mockLoad.mockResolvedValue({ isAllowed: () => true } as never);
    const resolver = new RobotsResolver({ userAgent: 'ua' });
    expect(await resolver.allow('https://shop.test/prod/1')).toBe(true);
    expect(mockLoad).toHaveBeenCalledWith('https://shop.test/robots.txt', undefined, { useragent: 'ua' });
  });

  it('robots.txt bloquea → false con el UA del resolver', async () => {
    const isAllowed = vi.fn((_url: string, ua?: string) => ua !== 'ua-ar');
    mockLoad.mockResolvedValue({ isAllowed } as never);
    const resolver = new RobotsResolver({ userAgent: 'ua-ar' });
    expect(await resolver.allow('https://shop.test/prod/1')).toBe(false);
    expect(isAllowed).toHaveBeenCalledWith('https://shop.test/prod/1', 'ua-ar');
  });

  it('URL inválida → false', async () => {
    const resolver = new RobotsResolver({ userAgent: 'ua' });
    expect(await resolver.allow('not-a-url')).toBe(false);
  });

  it('error de red / sin robots → fail-open (true)', async () => {
    mockLoad.mockRejectedValue(new Error('timeout'));
    const resolver = new RobotsResolver({ userAgent: 'ua' });
    expect(await resolver.allow('https://shop.test/prod/1')).toBe(true);
  });

  it('cachea el doc por host (una sola consulta de robots)', async () => {
    mockLoad.mockResolvedValue({ isAllowed: () => true } as never);
    const resolver = new RobotsResolver({ userAgent: 'ua' });
    await resolver.allow('https://shop.test/a');
    await resolver.allow('https://shop.test/b');
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});