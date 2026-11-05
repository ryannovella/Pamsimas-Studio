FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (git for updater/version metadata, font packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Setup permissions for Hugging Face Spaces non-root user (UID 1000)
RUN useradd -m -u 1000 user && \
    mkdir -p data/uploads data/temp_media data/logs output/backups && \
    chown -R user:user /app

USER user

ENV PORT=7860
ENV SERVER_HOST=0.0.0.0
ENV PYTHONUNBUFFERED=1

EXPOSE 7860

CMD ["python", "server.py"]
