FROM scratch

LABEL org.opencontainers.image.title="Llama.cpp API Remoting Podman Desktop extension" \
    org.opencontainers.image.description="Enables the acceleration of llama.cpp inference with API Remoting" \
    org.opencontainers.image.vendor="podman-desktop" \
    io.podman-desktop.api.version=">= 0.12.0"

COPY package.json /extension/
COPY icon.png /extension/
COPY dist /extension/dist

# /extension/build will be populated by the build system
