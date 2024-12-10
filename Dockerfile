FROM node:20-slim

WORKDIR /app/www_project

COPY package.json .

RUN npm install

COPY . .

RUN npm install prisma @prisma/client

RUN npm run migrate:2

EXPOSE 8000

CMD [ "npm", "run", "prod" ]