# 333rd Mad Ducks Notification Bot

A modern, branded Discord bot for the 333rd Mad Ducks, built by zevinDev. The bot scrapes a Microsoft Forms page for dropdown items and provides dynamic slash commands, automated notifications, and a settings menu for server owners.

## Features

- **Dynamic Slash Commands:** One command for each dropdown item on the Microsoft Forms page.
- **Automated Notifications:** Sends updates to a configured channel and pings selected roles when monitored pages change.
- **Settings Menu:** Server owners can select which pages to monitor, which roles to ping, and which channel to use.
- **Ephemeral Replies:** All bot responses are ephemeral and use Discord embeds for a clean look.
- **Persistent Settings:** Per-guild settings and notification state are saved to disk.

## Slash Commands

### `/[dropdown_item]`

- **Description:** Fetches the latest content for the selected dropdown item from the Microsoft Forms page.
- **Usage:** `/[dropdown_item]`
- **Access:** All users
- **Note:** The command name is a normalized, truncated version of the dropdown item text (max 32 characters, lowercase, underscores for spaces).

### `/settings`

- **Description:** Opens an interactive menu for server owners to configure notification settings.
- **Usage:** `/settings`
- **Access:** Server owner only
- **Menu Options:**
  - Select pages to monitor (multi-select)
  - Select roles to ping (multi-select)
  - Select a channel for notifications

### `/testping`

- **Description:** Sends a test notification to the configured channel and roles, using real scraped content.
- **Usage:** `/testping`
- **Access:** Server owner only

## Automated Notifications

- The bot checks for updates to monitored pages every 5 minutes.
- If a page's content changes, a notification is sent to the configured channel, pinging the selected roles.
- Notifications are sent as Discord embeds, split into multiple messages if needed.

## Setup

1. Clone the repository.
2. Run `bun install` to install dependencies.
3. Add your Discord bot token to a `.env` file as `DISCORD_TOKEN`.
4. Start the bot with `bun run src/bot.js`.

## Environment & Files

- `.env` — Discord bot token
- `guildSettings.json` — Per-guild notification settings (auto-generated)
- `lastSentContent.json` — Tracks last sent content for notification deduplication (auto-generated)

## Author

- zevinDev

---

For any issues or feature requests, please contact zevinDev.
