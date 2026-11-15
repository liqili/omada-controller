FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# openssl creates the self-signed HTTPS certificate on first start (tls-cert.sh).
RUN apk add --no-cache openssl
# Where the UI's /controller-api/* and /terminal/ws go. Override at run time
# (docker run -e / compose environment) to use a controller elsewhere.
ENV OMADA_CONTROLLER_URL=https://omada-controller:8043 \
    TERMINAL_GATEWAY_URL=http://omada-terminal:8091 \
    WEB_UI_HTTPS_PORT=8443
# The nginx image renders /etc/nginx/templates/*.template into conf.d at start.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY controller-url.envsh /docker-entrypoint.d/15-controller-url.envsh
COPY tls-cert.sh /docker-entrypoint.d/16-tls-cert.sh
RUN chmod +x /docker-entrypoint.d/15-controller-url.envsh /docker-entrypoint.d/16-tls-cert.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
