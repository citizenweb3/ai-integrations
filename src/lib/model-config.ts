export const modelConfig = {
  answerModel: 'gemini-3-flash-preview',
  rewriteModel: 'gemini-2.5-flash',
  rerankModel: 'gemini-2.5-flash',
  embeddingModel: 'gemini-embedding-001',
  vertexProject: process.env.GOOGLE_CLOUD_PROJECT?.trim() || undefined,
  vertexLocation: 'global',
};

export const hasVertexConfig = (): boolean => Boolean(modelConfig.vertexProject && modelConfig.vertexLocation);
