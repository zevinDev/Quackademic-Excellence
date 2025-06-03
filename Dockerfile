# Dockerfile for Quackademic Excellence Discord Bot (Bun + Puppeteer + Railway)

# Start from Debian slim for Puppeteer compatibility
FROM debian:bookworm-slim

# Install system dependencies for Puppeteer/Chromium
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    curl \
    unzip \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy package.json and bun.lockb if present
COPY package.json ./
COPY bun.lockb* ./

# Install dependencies with Bun
RUN bun install --production

# Copy the rest of the app
COPY . .

# Puppeteer: do NOT skip Chromium download (let Puppeteer manage it)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV NODE_ENV=production
ENV PORT=3000

# Railway: Set environment variables
ARG DISCORD_TOKEN
ENV DISCORD_TOKEN=${DISCORD_TOKEN}
ARG FORM_LINK
ENV FORM_LINK=${FORM_LINK}

# Start the bot with Bun
CMD ["bun", "src/bot.js"]
