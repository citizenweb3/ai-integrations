const chatApiUrl = process.env.CHAT_API_URL ?? 'http://127.0.0.1:3010/api/chat';

const run = async () => {
  const response = await fetch(chatApiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify({
      sessionId: `smoke-${Date.now()}`,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'What are Logos Improvement Proposals?' }],
        },
      ],
    }),
  });

  const body = await response.text();
  console.log(body);

  if (!response.ok) {
    throw new Error(`Expected chat API 2xx, got ${response.status}: ${body}`);
  }

  if (!body.includes('Logos') || !body.includes('source')) {
    throw new Error('Expected streamed chat response to include Logos answer text and source metadata');
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
