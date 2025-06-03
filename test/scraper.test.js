// test/scraper.test.js
// Author: zevinDev

import { describe, it, expect } from 'bun:test';
import * as scraper from '../src/scraper.js';
import puppeteer from 'puppeteer';

// NOTE: Bun does not support vi.mock, jest.mock, beforeAll, or afterAll. These tests are integration-style and will run real code.Add commentMore actions
// Puppeteer browser/page are launched once for all tests and closed at process exit.

let browser;
let page;

async function setup() {
  if (!browser) {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.goto('https://forms.osi.apps.mil/pages/responsepage.aspx?id=jbExg4ct70ijX6yIGOv5tOOqd51XqHlGnrbdLSCZ8wxUQUVXMEhZQjlHR0hDOUdWUk5ZVVlXTjRHTy4u', { waitUntil: 'networkidle2' });
  }
}

process.on('exit', async () => {
  if (browser) await browser.close();
});

describe('scraper', () => {
  it('getDropdownItems returns an array', async () => {
    await setup();
    const items = await scraper.getDropdownItems(page);
    expect(Array.isArray(items)).toBe(true);
  });

  it('getContentForDropdownItem returns a string', async () => {
    await setup();
    const items = await scraper.getDropdownItems(page);
    if (items.length > 0) {
      const content = await scraper.getContentForDropdownItem(page, items[0]);
      expect(typeof content).toBe('string');
    }
  });
});