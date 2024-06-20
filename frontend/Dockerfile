FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
ARG WS_URL
ARG VERSION
ARG NEURON_VERSION
RUN npm install && npm run build

FROM alpine:3.20

RUN apk add --no-cache nginx bash bash-completion vim

ADD nginx.conf /etc/nginx/http.d/default.conf
COPY --from=builder /app/dist/* /var/lib/nginx/html/

EXPOSE 8000

RUN sed -i '/^user nginx;/d' /etc/nginx/nginx.conf
RUN touch /run/nginx/nginx.pid \
    && chmod a+rw  /run/nginx/nginx.pid             \
    && chmod a+rw  /var/log/nginx                   \
    && chmod a+rx  /var/lib/nginx                   \
    && chmod a+rwx /var/lib/nginx/tmp

CMD ["nginx", "-g", "daemon off;"]
