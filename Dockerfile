FROM node:18-alpine

WORKDIR /app/www_project

RUN apk add --no-cache openssl

COPY package.json .

RUN npm install

COPY . .

RUN npm install prisma@5.17.0 @prisma/client@5.17.0

RUN npm run migrate:2

EXPOSE 8000

CMD [ "npm", "run", "prod" ]