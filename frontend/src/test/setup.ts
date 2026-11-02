import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { resetMockStore } from '../mocks/store';
import { server } from '../mocks/server';

configure({asyncUtilTimeout: 3000});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetMockStore());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
