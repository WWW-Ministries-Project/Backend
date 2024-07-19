FROM node:alpine

WORKDIR /app/www_project

COPY package.json .

RUN yarn install

COPY . .

RUN yarn run migrate:2

EXPOSE 8000

CMD [ "yarn", "run", "prod" ]