import { createVertex } from '@ai-sdk/google-vertex';

import { modelConfig } from '@/lib/model-config';

let cachedVertex: ReturnType<typeof createVertex> | null = null;

const vertexProvider = (): ReturnType<typeof createVertex> => {
  cachedVertex ??= createVertex({
    project: modelConfig.vertexProject,
    location: modelConfig.vertexLocation,
  });

  return cachedVertex;
};

export const answerLanguageModel = () => vertexProvider()(modelConfig.answerModel);

export const rewriteLanguageModel = () => vertexProvider()(modelConfig.rewriteModel);

export const rerankLanguageModel = () => vertexProvider()(modelConfig.rerankModel);

export const embeddingModel = () => vertexProvider().textEmbeddingModel(modelConfig.embeddingModel);
