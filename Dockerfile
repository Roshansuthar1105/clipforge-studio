# Multi-stage build: Frontend React + TypeScript builder
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Production Python backend
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/var/data

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Copy compiled frontend from builder
COPY --from=frontend-builder /frontend/dist ./frontend/dist

RUN mkdir -p /var/data/downloads /var/data/clips

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
