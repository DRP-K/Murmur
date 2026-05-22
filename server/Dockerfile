# ── Build stage ───────────────────────────────────────────────────────────────
FROM rust:1.87-slim AS builder

# rusqlite "bundled" compiles SQLite from C source — needs cc + libssl headers
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependency compilation separately from source changes
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
# Touch main.rs so Cargo rebuilds the binary (not just deps)
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false appuser

WORKDIR /app
COPY --from=builder /build/target/release/server ./server

RUN mkdir -p /data && chown appuser:appuser /data
USER appuser

ENV PORT=8080
ENV DATA_DIR=/data

EXPOSE 8080

ENTRYPOINT ["./server"]
