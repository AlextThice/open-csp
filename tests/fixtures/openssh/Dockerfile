FROM alpine:3.22.1
RUN apk add --no-cache openssh-server openssh-client && adduser -D -s /bin/sh fixture && echo 'fixture:fixture-password-only' | chpasswd
COPY openssh/sshd_config /etc/ssh/sshd_config
COPY openssh/start.sh /start.sh
RUN chmod 755 /start.sh
EXPOSE 22
ENTRYPOINT ["/bin/sh", "/start.sh"]
