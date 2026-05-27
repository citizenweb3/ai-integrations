FROM python:3.12-slim

# Non-root user
RUN useradd -m -s /bin/bash agent

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chown -R agent:agent /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER agent
ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "main.py"]
