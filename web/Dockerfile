FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Where the UI's /controller-api/* and /terminal/ws go. Override at run time
# (docker run -e / compose environment) to use a controller elsewhere.
ENV OMADA_CONTROLLER_URL=https://omada-controller:8043 \
    TERMINAL_GATEWAY_URL=http://omada-terminal:8091
# The nginx image renders /etc/nginx/templates/*.template into conf.d at start.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY controller-url.envsh /docker-entrypoint.d/15-controller-url.envsh
RUN chmod +x /docker-entrypoint.d/15-controller-url.envsh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
