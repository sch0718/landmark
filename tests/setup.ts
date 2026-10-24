import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  try {
    localStorage.setItem(
      'tripmap:help-seen:v1',
      JSON.stringify([
        'library',
        'map',
        'add',
        'place',
        'labels',
        'trips',
        'meetings',
        'share',
        'settings',
      ]),
    );
  } catch {
    // 저장소 접근을 막아 둔 시험도 진행할 수 있어야 한다.
  }
});

// globals를 쓰지 않으므로 RTL 자동 정리가 동작하지 않는다.
afterEach(() => {
  cleanup();
});
