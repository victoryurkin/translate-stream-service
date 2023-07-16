FROM node:lts-alpine3.18

USER root

WORKDIR /usr/local/app

RUN apk update --no-cache && apk upgrade

COPY . .

RUN yarn

EXPOSE 3000

ENTRYPOINT [ "yarn", "start" ]
