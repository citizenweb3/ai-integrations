import type { RagEmbedFn } from "@bizdev/db";
import { NonRetryableJobError } from "@bizdev/shared";
import { v1, helpers } from "@google-cloud/aiplatform";

const { PredictionServiceClient } = v1;

// Vertex AI text embedding provider for the RAG indexing pipeline.
// Wraps `gemini-embedding-001` (or any compatible Vertex embedding model)
// behind the `RagEmbedFn` interface so the embedding worker can swap stub
// for production without touching the indexing code.
//
// Auth: Application Default Credentials (ADC) — set
// `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON path, or rely
// on the GCE/Cloud Run/GKE metadata server. The SDK picks up either path
// automatically — no key handling in the worker.
//
// Output dimensionality: defaults to 1536 to keep parity with the
// `vector(1536)` column. `gemini-embedding-001` supports Matryoshka-style
// truncation at 768/1536/3072. Note: `text-embedding-004` only supports up
// to 768 and will 400 at 1536 — keep the schema and model in sync.

export type VertexRagEmbedderConfig = {
  projectId: string;
  location: string;
  model: string;
  outputDimensionality: number;
  // Vertex's batch endpoint accepts up to 250 instances per call; we keep
  // it lower by default to bound per-request latency and stay under the
  // per-minute token quota at peak.
  maxBatchSize?: number;
  // `RETRIEVAL_DOCUMENT` for indexed corpus chunks; queries (R3) use
  // `RETRIEVAL_QUERY` so the embedding space is asymmetric per Vertex
  // recommendation.
  taskType?: string;
};

export function createVertexRagEmbedder(config: VertexRagEmbedderConfig): RagEmbedFn {
  const apiEndpoint = `${config.location}-aiplatform.googleapis.com`;
  const client = new PredictionServiceClient({ apiEndpoint });
  const endpoint =
    `projects/${config.projectId}/locations/${config.location}` +
    `/publishers/google/models/${config.model}`;
  const batchSize = config.maxBatchSize ?? 25;
  const taskType = config.taskType ?? "RETRIEVAL_DOCUMENT";

  return async (texts) => {
    if (texts.length === 0) return [];

    const out: { vector: number[]; model: string }[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const instances = slice.map((content) =>
        helpers.toValue({ content, task_type: taskType })!
      );
      const parameters = helpers.toValue({
        outputDimensionality: config.outputDimensionality
      })!;

      let response;
      try {
        const [resp] = await client.predict({ endpoint, instances, parameters });
        response = resp;
      } catch (error) {
        // 4xx auth / quota / invalid-arg → don't burn retries; the worker
        // policy short-circuits to dead-letter so ops can fix config.
        const code = (error as { code?: number }).code;
        if (code === 3 || code === 7 || code === 16 || code === 9) {
          throw new NonRetryableJobError(
            `vertex embed permanent failure (code=${code}): ${(error as Error).message}`
          );
        }
        throw error;
      }

      const predictions = response.predictions ?? [];
      if (predictions.length !== slice.length) {
        throw new Error(
          `vertex embed returned ${predictions.length} predictions for ${slice.length} inputs`
        );
      }
      for (const pred of predictions) {
        const decoded = helpers.fromValue(pred as never) as
          | { embeddings?: { values?: number[] } }
          | undefined;
        const values = decoded?.embeddings?.values;
        if (!Array.isArray(values) || values.length === 0) {
          throw new Error("vertex embed returned empty values");
        }
        if (values.length !== config.outputDimensionality) {
          throw new Error(
            `vertex embed returned ${values.length}-dim vector, expected ${config.outputDimensionality}`
          );
        }
        out.push({ vector: values, model: config.model });
      }
    }
    return out;
  };
}

// Query-side companion. Uses the same Vertex client + model but with
// `task_type=RETRIEVAL_QUERY` so the embedding space is asymmetric to the
// indexed-corpus side (Vertex docs recommend asymmetric task types for
// retrieval: improves precision over a single general-purpose space).
export function createVertexRagQueryEmbedder(
  config: VertexRagEmbedderConfig
): RagEmbedFn {
  return createVertexRagEmbedder({ ...config, taskType: "RETRIEVAL_QUERY" });
}

export function readVertexRagEmbedderConfigFromEnv(): VertexRagEmbedderConfig | null {
  const projectId = process.env.VERTEX_PROJECT_ID;
  if (!projectId) return null;
  const location = process.env.VERTEX_LOCATION ?? "us-central1";
  const model = process.env.VERTEX_RAG_EMBED_MODEL ?? "gemini-embedding-001";
  const dimRaw = process.env.VERTEX_RAG_EMBED_DIMENSIONS;
  const outputDimensionality = dimRaw ? Number(dimRaw) : 1536;
  if (!Number.isInteger(outputDimensionality) || outputDimensionality <= 0) {
    throw new Error(
      `VERTEX_RAG_EMBED_DIMENSIONS must be a positive integer (got: ${dimRaw})`
    );
  }
  return { projectId, location, model, outputDimensionality };
}
