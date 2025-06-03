// src/scraper.js
// Author: zevinDev

import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
dotenv.config();

const FORM_URL = process.env.FORM_LINK;
console.log('[Scraper] FORM_LINK:', FORM_URL);

/**
 * Launches a headless browser and navigates to the form page.
 * @returns {Promise<puppeteer.Page>} The Puppeteer page instance.
 * @author zevinDev
 */
export async function launchFormPage() {
  // Use --no-sandbox in production/Docker
  const puppeteerArgs = process.env.NODE_ENV === 'production' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  const browser = await puppeteer.launch({ headless: true, args: puppeteerArgs });
  const page = await browser.newPage();
  try {
    await page.goto(FORM_URL, { waitUntil: 'networkidle2' });
  } catch (err) {
    console.error('[Scraper] Error navigating to form:', err);
    throw err;
  }
  return { browser, page };
}

/**
 * Gets all dropdown items from the custom ARIA dropdown.
 * @returns {Promise<string[]>} Array of dropdown item texts.
 * @author zevinDev
 */
export async function getDropdownItems(page) {
  try {
    await page.waitForSelector('div[role="button"][aria-haspopup="listbox"]');
    await page.click('div[role="button"][aria-haspopup="listbox"]');
    await page.waitForSelector('div[role="listbox"]');
    const options = await page.$$eval('div[role="listbox"] [role="option"]', opts => opts.map(o => o.textContent.trim()).filter(Boolean));
    await page.keyboard.press('Escape');
    if (options.length === 0) {
      console.warn('[Scraper] No dropdown items found!');
    }
    return options;
  } catch (err) {
    console.error('[Scraper] Error getting dropdown items:', err);
    throw err;
  }
}

/**
 * Gets the content after selecting a dropdown item and pressing Next (custom ARIA dropdown).
 * @param {string} itemText - The visible text of the dropdown item to select.
 * @returns {Promise<string>} The content after navigation.
 * @author zevinDev
 */
export async function getContentForDropdownItem(page, itemText) {
  try {
    await page.waitForSelector('div[role="button"][aria-haspopup="listbox"]');
    await page.click('div[role="button"][aria-haspopup="listbox"]');
    await page.waitForSelector('div[role="listbox"]');
    const options = await page.$$('div[role="listbox"] [role="option"]');
    let found = false;
    for (const option of options) {
      const text = await option.evaluate(el => el.textContent.trim());
      if (text === itemText) {
        await option.click();
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(`[Scraper] Dropdown item not found: '${itemText}'`);
      throw new Error(`Dropdown item not found: ${itemText}`);
    }
    await page.waitForSelector('button[data-automation-id="nextButton"]');
    await page.click('button[data-automation-id="nextButton"]');
    await page.waitForSelector('button[data-automation-id="backButton"]', { timeout: 30000 });
    await new Promise(res => setTimeout(res, 1000));
    const content = await page.evaluate(() => document.body.innerText);
    // Remove the first 2 lines from the content
    let cleanedContent = content.split('\n').slice(2).join('\n').trim();
    // Remove all content after "Select \"Back\"" or "Back\nSubmit"
    const selectBackMatch = cleanedContent.match(/Select\s*["'“”‘’`]?Back["'“”‘’`]?/i);
    const backSubmitMatch = cleanedContent.match(/Back\s*\n\s*Submit/i);
    let cutIdx = -1;
    if (selectBackMatch && backSubmitMatch) {
      cutIdx = Math.min(selectBackMatch.index, backSubmitMatch.index);
    } else if (selectBackMatch) {
      cutIdx = selectBackMatch.index;
    } else if (backSubmitMatch) {
      cutIdx = backSubmitMatch.index;
    }
    if (cutIdx !== -1) {
      cleanedContent = cleanedContent.slice(0, cutIdx).trim();
    }
    await page.click('button[data-automation-id="backButton"]');
    await page.waitForSelector('div[role="button"][aria-haspopup="listbox"]', { timeout: 30000 });
    return cleanedContent;
  } catch (err) {
    console.error(`[Scraper] Error getting content for '${itemText}':`, err);
    throw err;
  }
}

/**
 * Gets all dropdown items and their corresponding content.
 * @returns {Promise<Array<{item: string, content: string}>>}
 * @author zevinDev
 */
export async function getAllDropdownItemsAndContent() {
  // Use --no-sandbox in production/Docker
  const puppeteerArgs = process.env.NODE_ENV === 'production' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  const browser = await puppeteer.launch({ headless: true, args: puppeteerArgs });
  const page = await browser.newPage();
  try {
    await page.goto(FORM_URL, { waitUntil: 'networkidle2' });
    const items = await getDropdownItems(page);
    const results = [];
    for (const item of items) {
      try {
        const content = await getContentForDropdownItem(page, item);
        results.push({ item, content });
      } catch (err) {
        results.push({ item, content: null, error: err.message });
        console.error(`[Scraper] Error getting content for '${item}':`, err);
      }
    }
    await browser.close();
    return results;
  } catch (err) {
    console.error('[Scraper] Error in getAllDropdownItemsAndContent:', err);
    await browser.close();
    throw err;
  }
}

// If run directly, print all dropdown items and their content
if (import.meta.main) {
  (async () => {
    try {
      const results = await getAllDropdownItemsAndContent();
      for (const { item, content, error } of results) {
        if (error) {
          console.error(`[Scraper] Error for '${item}':`, error);
        }
      }
    } catch (err) {
      console.error('[Scraper] Fatal error:', err);
    }
  })();
}
