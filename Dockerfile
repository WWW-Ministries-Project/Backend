FROM node:18-alpine

WORKDIR /app/www_project

RUN apk add --no-cache \
    openssl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Use the Alpine (musl) Chromium instead of Puppeteer's bundled glibc build,
# which cannot launch on Alpine and makes PDF report generation 500.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package.json .

RUN npm install

COPY . .

RUN npm install prisma@5.17.0 @prisma/client@5.17.0

RUN npm run migrate:2

EXPOSE 8000

CMD [ "sh", "-c", "npm run migrate && npm run prod" ]
