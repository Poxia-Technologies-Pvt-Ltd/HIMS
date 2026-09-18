FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# Pass backend URL at build time if needed
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine

# VAPT #22 (CSP): connect-src for the API origin is filled in at container
# start (not build time) via the official nginx image's envsubst-on-templates
# entrypoint step, since the same built image can be deployed against
# different API hosts. Must be a value nginx's env var syntax can substitute,
# e.g. "https://api.example.com" — defaults to empty (same-origin API only).
ENV CSP_CONNECT_SRC=""
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY security-headers.inc.template /etc/nginx/templates/security-headers.inc.template

# Copy the built app to Nginx's web root
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
