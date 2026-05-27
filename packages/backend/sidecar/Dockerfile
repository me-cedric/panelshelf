# ── curl_cffi Sidecar ──
# Lightweight Python service using curl_cffi to bypass Cloudflare.
#
# Build:  docker build -t panelshelf-curl-cffi -f Dockerfile .
# Run:    docker run -p 8192:8192 panelshelf-curl-cffi

FROM python:3.12-slim

WORKDIR /app

# Install system dependencies needed by curl_cffi (libcurl + SSL)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the server
COPY server.py .

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8192/health')"

EXPOSE 8192

# Use exec form so signals are handled correctly
CMD ["python3", "server.py"]
