FROM --platform=$TARGETPLATFORM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM --platform=$TARGETPLATFORM node:22-alpine

RUN apk add --no-cache libarchive-tools ffmpeg

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data /gallery && chown -R node:node /app /gallery

ENV NODE_ENV=production
ENV PORT=8080
ENV GALLERY_ROOT=/gallery

USER node

EXPOSE 8080

VOLUME ["/gallery"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/ping',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]