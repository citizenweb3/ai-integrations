const startedAt = new Date().toISOString();

console.log(
  JSON.stringify({
    service: 'logos-chatbot-indexer',
    level: 'info',
    event: 'started',
    message: 'Indexer placeholder started. Cron jobs will be added in the indexer ticket.',
    startedAt,
  }),
);

const heartbeat = setInterval(() => {
  console.log(
    JSON.stringify({
      service: 'logos-chatbot-indexer',
      level: 'info',
      event: 'heartbeat',
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
}, 60_000);

const shutdown = (signal: NodeJS.Signals) => {
  clearInterval(heartbeat);
  console.log(
    JSON.stringify({
      service: 'logos-chatbot-indexer',
      level: 'info',
      event: 'shutdown',
      signal,
    }),
  );
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
