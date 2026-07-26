FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Tectonic LaTeX compiler
RUN curl -fsSL https://drop.infra.mesa3d.org/tectonic/releases/latest/tectonic-x86_64-unknown-linux-musl.tar.gz \
    | tar xz -C /usr/local/bin

# Install uv (fast Python package manager)
RUN pip install uv --no-cache-dir

WORKDIR /app

# Copy dependency spec first (layer caching)
COPY pyproject.toml ./

# Install production dependencies
RUN uv pip install --system --no-cache -e "."

# Copy application source
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY latex-assets/ ./latex-assets/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
