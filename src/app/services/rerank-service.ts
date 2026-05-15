import { generateText } from 'ai';
import { z } from 'zod';

import { hasVertexConfig } from '@/lib/model-config';
import { rerankLanguageModel } from '@/lib/vertex-provider';

export type RerankCandidate = {
  id: number;
  sourceId: number;
  chunkIndex: number;
  content: string;
  contextPrefix: string | null;
  sectionPath: string | null;
  language: string | null;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: string;
  rrfScore: number;
};

export type RerankedChunk = RerankCandidate & {
  rerankScore: number;
};

const rerankResponseSchema = z.object({
  rankings: z.array(
    z.object({
      id: z.number().int(),
      score: z.number().min(0).max(10),
    }),
  ),
});

const fallback = (candidates: RerankCandidate[], limit: number): RerankedChunk[] => {
  return candidates.slice(0, limit).map((candidate, index) => ({
    ...candidate,
    rerankScore: Math.max(0, 10 - index),
  }));
};

const buildPrompt = (query: string, candidates: RerankCandidate[]): string => {
  const chunks = candidates
    .map((candidate) => {
      const preview = [candidate.contextPrefix, candidate.content].filter(Boolean).join('\n').slice(0, 700);
      return `ID: ${candidate.id}
Source: ${candidate.sourceTitle}
Section: ${candidate.sectionPath ?? 'n/a'}
Text:
${preview}`;
    })
    .join('\n\n---\n\n');

  return `Rate each candidate chunk for answering the query on a 0-10 relevance scale.
Return only JSON with this exact shape: {"rankings":[{"id":123,"score":8.5}]}.

Query:
${query}

Candidates:
${chunks}`;
};

const parseRerankResponse = (text: string): z.infer<typeof rerankResponseSchema> => {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  return rerankResponseSchema.parse(JSON.parse(jsonText));
};

const rerank = async (query: string, candidates: RerankCandidate[], limit = 8): Promise<RerankedChunk[]> => {
  if (candidates.length === 0) return [];
  if (!hasVertexConfig()) return fallback(candidates, limit);

  try {
    const result = await generateText({
      model: rerankLanguageModel(),
      prompt: buildPrompt(query, candidates),
      temperature: 0,
    });

    const parsed = parseRerankResponse(result.text);
    const scores = new Map(parsed.rankings.map((ranking) => [ranking.id, ranking.score]));

    return candidates
      .map((candidate) => ({
        ...candidate,
        rerankScore: scores.get(candidate.id) ?? 0,
      }))
      .sort((a, b) => b.rerankScore - a.rerankScore || b.rrfScore - a.rrfScore)
      .slice(0, limit);
  } catch (error) {
    console.warn('[retrieval] rerank failed; using RRF fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback(candidates, limit);
  }
};

const rerankService = {
  rerank,
};

export default rerankService;
