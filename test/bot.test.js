// test/bot.test.js
// Author: zevinDev

import { describe, it, expect } from 'bun:test';
import { startBot } from '../src/bot.js';

// NOTE: Bun does not support jest.mock or vi.mock. These tests are integration-style and will run real code.
// For true unit tests, refactor bot.js for dependency injection or use a supported test runner.

describe('bot', () => {
  it('startBot initializes and returns a client', async () => {
    let client;
    try {
      client = await startBot();
      expect(client).toBeDefined();
      expect(typeof client.login).toBe('function');
    } finally {
      if (client && client.destroy) await client.destroy();
    }
  });
});