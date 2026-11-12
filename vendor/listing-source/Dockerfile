FROM node:20-alpine
WORKDIR /app
COPY listing-source-server.mjs listings.json ./
EXPOSE 4002
CMD ["node", "listing-source-server.mjs"]
