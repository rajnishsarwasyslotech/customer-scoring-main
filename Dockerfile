FROM node:20

WORKDIR /app

COPY middleware/package*.json ./

RUN npm ci

COPY middleware .

RUN chmod +x ./node_modules/.bin/tsc || true
RUN npx tsc -p tsconfig.json

EXPOSE 3000

CMD ["npm", "run", "start"]