import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// globals를 쓰지 않으므로 RTL 자동 정리가 동작하지 않는다.
afterEach(() => {
  cleanup();
});
