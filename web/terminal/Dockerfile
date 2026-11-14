FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY gateway.mjs server.mjs ./
USER node
EXPOSE 8091
CMD ["node", "server.mjs"]
