FROM node:20-alpine

ENV NODE_ENV=production

# System Chromium instead of puppeteer-core downloading its own — Alpine has
# no glibc, so the bundled Chromium puppeteer normally fetches won't run
# here anyway. Used to render lab reports as real HTML/CSS (see
# utils/pdfGenerator.js) rather than hand-positioning a PDF drawing API,
# which is the only way to guarantee the output actually matches an HTML
# reference design pixel-for-pixel instead of just approximating it.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 7005

CMD ["npm", "start"]
