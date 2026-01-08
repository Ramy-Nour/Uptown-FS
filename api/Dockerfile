# Base stage for both development and production
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

# Development stage (with Chromium for Puppeteer + LibreOffice for DOCX→PDF)
FROM base AS development
RUN apk add --no-cache \
    libreoffice \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-dejavu \
    fontconfig \
    font-noto \
    font-noto-cjk
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY . .

# Install custom fonts
COPY ./fonts /usr/share/fonts/custom
RUN fc-cache -f -v

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
    font-noto \
    font-noto-cjk
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY . .

# Install custom fonts
COPY ./fonts /usr/share/fonts/custom
RUN fc-cache -f -v

EXPOSE 3000
CMD ["npm", "start"]