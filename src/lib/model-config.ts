const firstEnv = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  return undefined;
};

export const modelConfig = {
  answerModel: process.env.ANSWER_MODEL ?? 'gemini-3-flash-preview',
  rewriteModel: process.env.REWRITE_MODEL ?? 'gemini-2.5-flash',
  rerankModel: process.env.RERANK_MODEL ?? 'gemini-2.5-flash',
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001',
  vertexProject: firstEnv('GOOGLE_VERTEX_PROJECT', 'GOOGLE_CLOUD_PROJECT'),
  vertexLocation: firstEnv('GOOGLE_VERTEX_LOCATION', 'GOOGLE_CLOUD_LOCATION') ?? 'global',
};

export const hasVertexConfig = (): boolean => Boolean(modelConfig.vertexProject && modelConfig.vertexLocation);
