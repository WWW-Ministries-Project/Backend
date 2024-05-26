FROM node:alpine

WORKDIR /app/www_project

COPY package.json .

RUN yarn install

COPY . .

RUN npm run migrate:2

EXPOSE 8000

CMD [ "npm", "run", "prod" ]