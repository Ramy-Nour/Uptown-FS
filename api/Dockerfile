# Base stage for both development and production
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

# Development stage (with Chromium for Puppeteer)
FROM base AS development
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-dejavu \
    fontconfig \
    font-noto
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production stage (with LibreOffice and Chromium for PDFs)
FROM base AS production
RUN apk add --no-cache \
    libreoffice \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-dejavu \
    fontconfig \
    font-noto
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY . .
EXPOSE 3000
CMD ["npm", "start"]