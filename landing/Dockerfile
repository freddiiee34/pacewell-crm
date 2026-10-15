# Landing Pacewell : pages statiques servies par nginx.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY *.html *.json /usr/share/nginx/html/
EXPOSE 80
