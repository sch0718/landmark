import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { mockViewport, renderApp } from './harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const MESSAGE = '이 브라우저에 저장할 수 없어 새로고침하면 사라져요';

describe('StorageBanner', () => {
  it('shows storage banner in memory mode', async () => {
    mockViewport(390);
    await renderApp({ storage: undefined });
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });

  it('is hidden when storage works', async () => {
    mockViewport(390);
    await renderApp({ storage: createMemoryStorage() });
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });
});
