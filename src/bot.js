// src/bot.js
// Author: zevinDev

import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from 'dotenv';
import { getDropdownItems, getContentForDropdownItem } from './scraper.js';
import puppeteer from 'puppeteer';
import { MongoClient } from 'mongodb';

// Load environment variables from .env file
dotenv.config();

/**
 * Initializes and starts the Discord bot.
 * @throws {Error} If the bot token is missing or login fails.
 * @author zevinDev
 */
export const startBot = async () => {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('Missing DISCORD_TOKEN in environment variables.');
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  let browser = null;
  let page = null;
  let dropdownItems = [];

  // --- LAUNCH BROWSER AND PAGE ONCE AT STARTUP ---
  async function launchBrowserAndPage() {
    if (!browser) {
      const puppeteerArgs = process.env.NODE_ENV === 'production' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
      console.log('[Puppeteer] Launching browser...');
      browser = await puppeteer.launch({ headless: true, args: puppeteerArgs });
      page = await browser.newPage();
    }
    const formUrl = process.env.FORM_LINK;
    console.log('[Puppeteer] Navigating to:', formUrl);
    try {
      await page.goto(formUrl, { waitUntil: 'networkidle2' });
      dropdownItems = await getDropdownItems(page);
      console.log(`[Puppeteer] Scraped ${dropdownItems.length} dropdown items.`);
      if (dropdownItems.length === 0) {
        console.warn('[Puppeteer] No dropdown items found!');
      }
    } catch (err) {
      console.error('[Puppeteer] Error during navigation or scraping:', err);
      dropdownItems = [];
    }
  }

  // --- REFRESH PAGE AND UPDATE CACHE AT INTERVAL ---
  async function refreshPageAndUpdateCache() {
    if (!browser || !page) {
      await launchBrowserAndPage();
      return;
    }
    try {
      await page.reload({ waitUntil: 'networkidle2' });
      dropdownItems = await getDropdownItems(page);
      console.log(`[Puppeteer] Refreshed and scraped ${dropdownItems.length} dropdown items.`);
      if (dropdownItems.length === 0) {
        console.warn('[Puppeteer] No dropdown items found after refresh!');
      }
    } catch (err) {
      console.error('[Puppeteer] Error during page refresh or scraping:', err);
      dropdownItems = [];
    }
    await updateAllDropdownCache();
  }

  // --- MONGODB CONNECTION ---
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGODB_URI in environment variables.');
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db();
  const dropdownCacheCol = db.collection('dropdownCache');
  const guildSettingsCol = db.collection('guildSettings');
  const lastSentContentCol = db.collection('lastSentContent');

  // --- CACHE SYSTEM FOR DROPDOWN CONTENT (MongoDB) ---
  async function writeDropdownCache(item, content) {
    await dropdownCacheCol.updateOne(
      { item },
      { $set: { item, content } },
      { upsert: true }
    );
  }
  async function readDropdownCache(item) {
    const doc = await dropdownCacheCol.findOne({ item });
    return doc?.content || '';
  }

  // Update all dropdown cache files (MongoDB)
  async function updateAllDropdownCache() {
    for (const item of dropdownItems) {
      try {
        const content = await getContentForDropdownItem(page, item);
        await writeDropdownCache(item, content);
      } catch {}
    }
  }

  // --- SETTINGS SYSTEM (MongoDB) ---
  // In-memory settings per guild: { [guildId]: { pages: Set<string>, roles: { [page]: Set<roleId> }, channel: channelId } }
  const guildSettings = {};

  // Load settings from MongoDB at startup
  const allSettings = await guildSettingsCol.find().toArray();
  for (const doc of allSettings) {
    guildSettings[doc.guildId] = {
      pages: new Set(doc.pages),
      roles: Object.fromEntries(
        Object.entries(doc.roles || {}).map(([page, roles]) => [page, new Set(roles)])
      ),
      channel: doc.channel ?? null,
    };
  }

  // Helper: persist settings to MongoDB
  async function saveSettings() {
    for (const [guildId, settings] of Object.entries(guildSettings)) {
      await guildSettingsCol.updateOne(
        { guildId },
        {
          $set: {
            guildId,
            pages: Array.from(settings.pages),
            roles: Object.fromEntries(
              Object.entries(settings.roles || {}).map(([page, roles]) => [page, Array.from(roles)])
            ),
            channel: settings.channel ?? null,
          },
        },
        { upsert: true }
      );
    }
  }

  // --- LAST SENT CONTENT SYSTEM (MongoDB) ---
  // In-memory cache: { [guildId]: { [pageName]: lastContentString } }
  const lastSentContent = {};
  const allLastSent = await lastSentContentCol.find().toArray();
  for (const doc of allLastSent) {
    lastSentContent[doc.guildId] = { ...doc.pages };
  }
  async function saveLastSentContent() {
    for (const [guildId, pages] of Object.entries(lastSentContent)) {
      await lastSentContentCol.updateOne(
        { guildId },
        { $set: { guildId, pages } },
        { upsert: true }
      );
    }
  }

  // Launch browser, load dropdown items, and cache at startup
  try {
    await launchBrowserAndPage();
    await updateAllDropdownCache();
  } catch (err) {
    console.error('[Startup] Error during initial browser launch or cache update:', err);
  }

  // Refresh page, dropdown items, and cache every 5 minutes
  setInterval(async () => {
    try {
      await refreshPageAndUpdateCache();
    } catch (err) {
      console.error('[Interval] Error during page refresh or cache update:', err);
    }
  }, 5 * 60 * 1000);

  // Helper: check if user is guild admin or owner
  function isGuildAdminOrOwner(interaction) {
    if (!interaction.guild) return false;
    // Check if user is owner
    if (interaction.user.id === interaction.guild.ownerId) return true;
    // Check if user has Administrator permission
    const member = interaction.member;
    if (member && member.permissions && member.permissions.has) {
      return member.permissions.has('Administrator');
    }
    // Fallback for raw permissions bitfield
    if (member && member.permissions && typeof member.permissions === 'object' && member.permissions.bitfield) {
      // Discord.js v14: Administrator = 0x00000008
      return (member.permissions.bitfield & 0x00000008) !== 0;
    }
    return false;
  }

  // Register slash commands for each dropdown item
  let commandNameToDropdownItem = {};
  client.once(Events.ClientReady, async () => {
    console.log('[Discord] Client ready. Registering slash commands...');
    // Register commands dynamically
    const usedNames = new Set();
    commandNameToDropdownItem = {};
    const commands = dropdownItems.map((item, idx) => {
      let name = item
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
      if (name.length > 32) {
        name = name.slice(0, 32);
      }
      let uniqueName = name;
      let suffix = 1;
      while (usedNames.has(uniqueName) || uniqueName.length === 0) {
        uniqueName = (name.slice(0, 32 - (`_${suffix}`).length) + `_${suffix}`);
        suffix++;
      }
      usedNames.add(uniqueName);
      commandNameToDropdownItem[uniqueName] = item;
      return {
        name: uniqueName,
        description: `Get info for: ${item}`,
      };
    });
    try {
      await client.application.commands.set([
        ...commands,
        {
          name: 'settings',
          description: 'Configure auto-messaging for page updates (admin/owner only)',
        },
        {
          name: 'testping',
          description: 'Send a test notification to the configured channel and roles (admin/owner only)',
        },
      ]);
      console.log('[Discord] Slash commands registered:', commands.map(c => c.name));
    } catch (err) {
      console.error('[Discord] Failed to register slash commands:', err);
    }
  });

  // --- INTERACTION HANDLER ---
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isCommand() && interaction.commandName === 'settings') {
        console.log(`[Command] /settings used by ${interaction.user.tag} in guild ${interaction.guildId}`);
        // Allow guild admin or owner
        if (!isGuildAdminOrOwner(interaction)) {
          await interaction.reply({ content: 'Only a server administrator or owner can use /settings.', flags: 64 });
          return;
        }
        // Show settings menu: select pages, roles, and channel
        const pageOptions = dropdownItems.map(item => ({ label: item, value: item }));
        const roleOptions = interaction.guild.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => ({ label: r.name, value: r.id })).slice(0, 25);
        if (pageOptions.length === 0) {
          await interaction.reply({ content: 'No dropdown items found. The bot may not be able to scrape the source page. Please try again later or check your Railway logs.', flags: 64 });
          return;
        }
        if (roleOptions.length === 0) {
          await interaction.reply({ content: 'No roles found in this server.', flags: 64 });
          return;
        }
        await interaction.reply({
          content: 'Configure which pages to monitor and which roles to ping. Select a channel to send updates.',
          components: [
            {
              type: 1, // ActionRow
              components: [
                {
                  type: 3, // StringSelect
                  custom_id: 'select_pages',
                  min_values: 1,
                  max_values: Math.min(pageOptions.length, 25),
                  options: pageOptions,
                  placeholder: 'Select pages to monitor',
                },
              ],
            },
            {
              type: 1,
              components: [
                {
                  type: 3,
                  custom_id: 'select_roles',
                  min_values: 0,
                  max_values: Math.min(roleOptions.length, 25),
                  options: roleOptions,
                  placeholder: 'Select roles to ping (optional)',
                },
              ],
            },
            {
              type: 1,
              components: [
                {
                  type: 8, // ChannelSelect
                  custom_id: 'select_channel',
                  channel_types: [0], // Only text channels
                  placeholder: 'Select a channel for updates',
                },
              ],
            },
          ],
          flags: 64,
        });
        return;
      }
      // --- /testping command ---
      if (interaction.isCommand() && interaction.commandName === 'testping') {
        console.log(`[Command] /testping used by ${interaction.user.tag} in guild ${interaction.guildId}`);
        if (!isGuildAdminOrOwner(interaction)) {
          await interaction.reply({ content: 'Only a server administrator or owner can use /testping.', flags: 64 });
          return;
        }
        const settings = guildSettings[interaction.guildId];
        if (!settings || !settings.channel || !settings.pages || settings.pages.size === 0) {
          await interaction.reply({ content: 'No notification channel or pages configured. Use /settings first.', flags: 64 });
          return;
        }
        const channel = interaction.guild.channels.cache.get(settings.channel);
        if (!channel || channel.type !== 0) {
          await interaction.reply({ content: 'Configured channel not found or not a text channel.', flags: 64 });
          return;
        }
        let sentCount = 0;
        for (const pageName of settings.pages) {
          const roleIds = (settings.roles && settings.roles[pageName]) ? Array.from(settings.roles[pageName]) : [];
          const roleMentions = roleIds.map(id => `<@&${id}>`).join(' ');
          let content = '';
          try {
            content = await getContentForDropdownItem(page, pageName);
          } catch (err) {
            content = 'Failed to fetch content for this page.';
            console.error(`[TestPing] Error fetching content for ${pageName}:`, err);
          }
          const chunks = [];
          for (let i = 0; i < content.length; i += 1900) {
            chunks.push(content.slice(i, i + 1900));
          }
          if (chunks.length === 0) {
            await channel.send({
              content: roleMentions || undefined,
              embeds: [{
                title: `Update: ${pageName}`,
                description: 'No content found.',
                color: 0x2b2d31,
                timestamp: new Date().toISOString(),
              }],
            });
          } else {
            await channel.send({
              content: roleMentions || undefined,
              embeds: [{
                title: `Update: ${pageName}`,
                description: chunks[0],
                color: 0x2b2d31,
                timestamp: new Date().toISOString(),
              }],
            });
            for (let j = 1; j < chunks.length; j++) {
              await channel.send({
                embeds: [{
                  description: chunks[j],
                  color: 0x2b2d31,
                  timestamp: new Date().toISOString(),
                }],
              });
            }
          }
          sentCount++;
        }
        console.log(`[TestPing] Sent test notifications for ${sentCount} page(s) in guild ${interaction.guildId}`);
        await interaction.reply({ content: `Test notification sent to <#${settings.channel}> for ${sentCount} page(s), with real content and pings.`, flags: 64 });
        return;
      }
      // Handle select menus and channel select
      if ((interaction.isStringSelectMenu() || interaction.isChannelSelectMenu())) {
        console.log(`[Command] Select menu used by ${interaction.user.tag} in guild ${interaction.guildId} (${interaction.customId})`);
        if (!isGuildAdminOrOwner(interaction)) {
          await interaction.reply({ content: 'Only a server administrator or owner can use /settings.', flags: 64 });
          return;
        }
        const settings = guildSettings[interaction.guildId] || { pages: new Set(), roles: {}, channel: null };
        if (interaction.customId === 'select_pages') {
          settings.pages = new Set(interaction.values);
          await interaction.reply({ content: `Pages to monitor updated.`, flags: 64 });
        } else if (interaction.customId === 'select_roles') {
          for (const page of settings.pages) {
            settings.roles[page] = new Set(interaction.values);
          }
          await interaction.reply({ content: `Roles to ping updated.`, flags: 64 });
        } else if (interaction.customId === 'select_channel') {
          settings.channel = interaction.values[0];
          await interaction.reply({ content: `Channel for updates set.`, flags: 64 });
        }
        guildSettings[interaction.guildId] = settings;
        await saveSettings();
        console.log(`[Settings] Updated settings for guild ${interaction.guildId}:`, guildSettings[interaction.guildId]);
        return;
      }
      if (!interaction.isCommand()) return;
      const commandName = interaction.commandName;
      const item = commandNameToDropdownItem[commandName];
      if (!item) {
        await interaction.reply({ content: 'Unknown command or dropdown item.', flags: 64 });
        console.warn(`[Command] Unknown command: ${commandName}`);
        return;
      }
      await interaction.deferReply({ flags: 64 });
      try {
        const content = await readDropdownCache(item);
        const chunks = [];
        for (let i = 0; i < content.length; i += 1900) {
          chunks.push(content.slice(i, i + 1900));
        }
        if (chunks.length === 0) {
          await interaction.editReply({ embeds: [{ description: 'No content found.' }] });
        } else {
          await interaction.editReply({ embeds: [{
            title: item,
            description: chunks[0],
            color: 0x2b2d31
          }] });
          for (let j = 1; j < chunks.length; j++) {
            await interaction.followUp({ embeds: [{
              description: chunks[j],
              color: 0x2b2d31
            }], flags: 64 });
          }
        }
        console.log(`[Command] Served cached content for '${item}' to ${interaction.user.tag} in guild ${interaction.guildId}`);
      } catch (err) {
        await interaction.editReply({ embeds: [{ description: 'Failed to fetch content. Please try again later.' }] });
        console.error(`[Command] Error serving cached content for '${item}':`, err);
      }
    } catch (err) {
      console.error('[Interaction] Unhandled error:', err);
    }
  });

  async function runNotificationJob() {
    for (const [guildId, settings] of Object.entries(guildSettings)) {
      if (!settings.channel || !settings.pages || settings.pages.size === 0) continue;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(settings.channel);
      if (!channel || channel.type !== 0) continue;
      if (!lastSentContent[guildId]) lastSentContent[guildId] = {};
      for (const pageName of settings.pages) {
        let content = '';
        try {
          content = await readDropdownCache(pageName);
        } catch (err) {
          console.error(`[Notify] Error reading cache for ${pageName} in guild ${guildId}:`, err);
          continue; // skip on error
        }
        if (content && content !== lastSentContent[guildId][pageName]) {
          const roleIds = (settings.roles && settings.roles[pageName]) ? Array.from(settings.roles[pageName]) : [];
          const roleMentions = roleIds.map(id => `<@&${id}>`).join(' ');
          const chunks = [];
          for (let i = 0; i < content.length; i += 1900) {
            chunks.push(content.slice(i, i + 1900));
          }
          if (chunks.length === 0) {
            await channel.send({
              content: roleMentions || undefined,
              embeds: [{
                title: `Update: ${pageName}`,
                description: 'No content found.',
                color: 0x2b2d31,
                timestamp: new Date().toISOString(),
              }],
            });
          } else {
            await channel.send({
              content: roleMentions || undefined,
              embeds: [{
                title: `Update: ${pageName}`,
                description: chunks[0],
                color: 0x2b2d31,
                timestamp: new Date().toISOString(),
              }],
            });
            for (let j = 1; j < chunks.length; j++) {
              await channel.send({
                embeds: [{
                  description: chunks[j],
                  color: 0x2b2d31,
                  timestamp: new Date().toISOString(),
                }],
              });
            }
          }
          lastSentContent[guildId][pageName] = content;
          await saveLastSentContent();
          console.log(`[Notify] Sent update for '${pageName}' in guild ${guildId} to channel ${settings.channel}`);
        }
      }
    }
  }

  // Scheduler: check every minute if it's a scheduled time in Central Time, and run the job if so
  let lastMinuteChecked = null;
  function getCentralTimeParts(date = new Date()) {
    // Use Intl.DateTimeFormat to get hour and minute in America/Chicago
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    return { hour, minute };
  }

  async function notificationScheduler() {
    const now = new Date();
    const { hour, minute } = getCentralTimeParts(now);
    const nowMinutes = hour * 60 + minute;
    // Allowed times: 15:33, 16:03, 16:33, ..., 22:00 (Central Time)
    let allowed = false;
    let t = 15 * 60 + 33;
    while (t <= 22 * 60) {
      if (nowMinutes === t) {
        allowed = true;
        break;
      }
      t += 30;
    }
    if (allowed && lastMinuteChecked !== nowMinutes) {
      console.log(`[Scheduler] Running notification job at ${hour}:${minute} (Central Time)`);
      await runNotificationJob();
      lastMinuteChecked = nowMinutes;
    }
    setTimeout(notificationScheduler, 60 * 1000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
  }
  notificationScheduler();

  // Log environment variables at startup (do not log secrets)
  console.log('[Env] DISCORD_TOKEN loaded:', !!process.env.DISCORD_TOKEN ? 'yes' : 'no');
  console.log('[Env] FORM_LINK:', process.env.FORM_LINK);

  process.on('unhandledRejection', (err) => {
    console.error('[Process] Unhandled rejection:', err);
  });

  try {
    await client.login(token);
    console.log('[Discord] Bot logged in and running.');
  } catch (err) {
    console.error('[Discord] Login failed:', err);
    throw err;
  }

  process.on('SIGINT', async () => {
    console.log('[Shutdown] SIGINT received. Closing browser and exiting...');
    if (browser) await browser.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.log('[Shutdown] SIGTERM received. Closing browser and exiting...');
    if (browser) await browser.close();
    process.exit(0);
  });

  // Add process exit diagnostics
  process.on('exit', (code) => {
    console.error(`[Process] exit event: code=${code}`);
  });
  process.on('beforeExit', (code) => {
    console.error(`[Process] beforeExit event: code=${code}`);
  });

  // Add a log at the end of startBot to confirm the bot is running
  console.log('[Bot] startBot function completed, bot should be running.');

  return client;
};

// Start the bot if this file is run directly
if (import.meta.main) {
  startBot().catch((err) => {
    console.error('[Fatal] startBot() failed:', err);
    process.exit(1);
  });
}