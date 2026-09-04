FROM node:24.20.0-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libuuid1 \
    libsecret-1-0 libasound2 libgbm1 xdg-utils desktop-file-utils \
    gnome-keyring dbus-x11 xvfb xauth fakeroot rpm \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.24.0
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm package:linux
RUN useradd --create-home --uid 1001 smoke && mkdir -p /workspace/test-results \
    && chown smoke:smoke /workspace /workspace/test-results
CMD ["bash", "tests/packaging/linux-container-smoke.sh"]
