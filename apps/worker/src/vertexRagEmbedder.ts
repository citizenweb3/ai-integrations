import type { RagEmbedFn } from "@bizdev/db";
import { NonRetryableJobError } from "@bizdev/shared";
import { v1, helpers } from "@google-cloud/aiplatform";

const { PredictionServiceClient } = v1;
const GEMINI_EMBEDDING_2_MODEL = "gemini-embedding-2";
const DEFAULT_OUTPUT_DIMENSIONALITY = 1536;

// Vertex AI text embedding provider for the RAG indexing pipeline.
// Wraps `gemini-embedding-2` (or any compatible Vertex embedding model)
// behind the `RagEmbedFn` interface so the embedding worker can swap stub
// for production without touching the indexing code.
//
// Auth: Application Default Credentials (ADC) — set
// `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON path, or rely
// on the GCE/Cloud Run/GKE metadata server. The SDK picks up either path
// automatically — no key handling in the worker.
//
// Output dimensionality: defaults to 1536 to keep parity with the
// `vector(1536)` column. `gemini-embedding-2` is served through the global
// `embedContent` API; legacy `gemini-embedding-001` remains supported through
// regional `predict` for rollback/reindex comparisons.

type VertexRagEmbeddingTransport = "predict" | "embed_content";

export type VertexRagEmbedderConfig = {
  projectId: string;
  location: string;
  model: string;
  outputDimensionality: number;
  transport: VertexRagEmbeddingTransport;
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
  const apiEndpoint = config.location === "global"
    ? "aiplatform.googleapis.com"
    : `${config.location}-aiplatform.googleapis.com`;
  const client = new PredictionServiceClient({ apiEndpoint });
  const endpoint =
    `projects/${config.projectId}/locations/${config.location}` +
    `/publishers/google/models/${config.model}`;
  const batchSize = config.maxBatchSize ?? 25;
  const taskType = config.taskType ?? "RETRIEVAL_DOCUMENT";
  const embedContentUrl =
    `https://aiplatform.googleapis.com/v1/projects/${config.projectId}` +
    `/locations/global/publishers/google/models/${config.model}:embedContent`;

  return async (texts) => {
    if (texts.length === 0) return [];

    const out: { vector: number[]; model: string }[] = [];

    if (config.transport === "embed_content") {
      if (config.location !== "global") {
        throw new NonRetryableJobError(
          `Vertex embedContent transport requires global location (got: ${config.location})`
        );
      }
      const authClient = await client.auth.getClient();
      for (const content of texts) {
        let values: number[];
        try {
          const response = await authClient.request({
            url: embedContentUrl,
            method: "POST",
            data: {
              content: { parts: [{ text: content }] },
              taskType,
              outputDimensionality: config.outputDimensionality
            },
            timeout: 90_000
          });
          values = extractEmbedContentValues(response.data);
        } catch (error) {
          handleVertexEmbedError(error);
        }
        assertEmbeddingDimensionality(values, config.outputDimensionality);
        out.push({ vector: values, model: config.model });
      }
      return out;
    }

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
        handleVertexEmbedError(error);
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
        assertEmbeddingDimensionality(values, config.outputDimensionality);
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
  const model = process.env.VERTEX_RAG_EMBED_MODEL ?? GEMINI_EMBEDDING_2_MODEL;
  const location = process.env.VERTEX_RAG_EMBED_LOCATION
    ?? (model === GEMINI_EMBEDDING_2_MODEL
      ? "global"
      : process.env.VERTEX_LOCATION ?? "us-central1");
  const transport: VertexRagEmbeddingTransport =
    model === GEMINI_EMBEDDING_2_MODEL ? "embed_content" : "predict";
  const dimRaw = process.env.VERTEX_RAG_EMBED_DIMENSIONS;
  const outputDimensionality = dimRaw ? Number(dimRaw) : DEFAULT_OUTPUT_DIMENSIONALITY;
  if (!Number.isInteger(outputDimensionality) || outputDimensionality <= 0) {
    throw new Error(
      `VERTEX_RAG_EMBED_DIMENSIONS must be a positive integer (got: ${dimRaw})`
    );
  }
  if (transport === "embed_content" && location !== "global") {
    throw new Error(
      `${GEMINI_EMBEDDING_2_MODEL} requires VERTEX_RAG_EMBED_LOCATION=global (got: ${location})`
    );
  }
  return { projectId, location, model, outputDimensionality, transport };
}

function extractEmbedContentValues(data: unknown): number[] {
  if (!data || typeof data !== "object") {
    throw new Error("vertex embedContent returned non-object response");
  }
  const embedding = (data as { embedding?: unknown }).embedding;
  if (!embedding || typeof embedding !== "object") {
    throw new Error("vertex embedContent returned empty embedding");
  }
  const values = (embedding as { values?: unknown }).values;
  if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "number")) {
    throw new Error("vertex embedContent returned empty values");
  }
  return values;
}

function assertEmbeddingDimensionality(values: number[], expected: number) {
  if (values.length !== expected) {
    throw new Error(
      `vertex embed returned ${values.length}-dim vector, expected ${expected}`
    );
  }
}

function handleVertexEmbedError(error: unknown): never {
  const code = (error as { code?: number }).code;
  const status = (error as { response?: { status?: number } }).response?.status;
  const message = error instanceof Error ? error.message : String(error);
  // 4xx auth / config / invalid-arg errors are permanent; 429 and 5xx should
  // remain retryable under the worker's normal retry policy.
  if (
    code === 3 || code === 7 || code === 16 || code === 9 ||
    (typeof status === "number" && status >= 400 && status < 500 && status !== 429)
  ) {
    throw new NonRetryableJobError(
      `vertex embed permanent failure (code=${code ?? status ?? "unknown"}): ${message}`
    );
  }
  throw error;
}
