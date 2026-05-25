import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  closeDb,
  getDb,
  organizations,
  ragChunks,
  ragDocuments,
  retrieveRagContext
} from "../src";

after(async () => {
  await closeDb();
});

test("retrieveRagContext only compares embeddings produced by the query model", async (t) => {
  const db = getDb();
  const suffix = randomUUID();
  await clearRagModelFilterArtifacts(suffix);
  t.after(() => clearRagModelFilterArtifacts(suffix));

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `t-rag-model-${suffix}`,
      domain: `t-rag-model-${suffix}.example`
    })
    .returning({ id: organizations.id });
  assert.ok(organization);

  const [oldDoc, newDoc] = await db
    .insert(ragDocuments)
    .values([
      {
        sourceType: "test",
        organizationId: organization.id,
        corpusLabel: "positive",
        title: `t-rag-model-old-${suffix}`,
        body: "Old embedding-space document.",
        eligibleForRetrieval: true
      },
      {
        sourceType: "test",
        organizationId: organization.id,
        corpusLabel: "positive",
        title: `t-rag-model-new-${suffix}`,
        body: "New embedding-space document.",
        eligibleForRetrieval: true
      }
    ])
    .returning({ id: ragDocuments.id });
  assert.ok(oldDoc);
  assert.ok(newDoc);

  const [oldChunk, newChunk] = await db
    .insert(ragChunks)
    .values([
      { documentId: oldDoc.id, chunkText: "old model chunk should be ignored" },
      { documentId: newDoc.id, chunkText: "new model chunk should be returned" }
    ])
    .returning({ id: ragChunks.id });
  assert.ok(oldChunk);
  assert.ok(newChunk);

  const queryVector = unitVector1536();
  const queryLiteral = vectorLiteral(queryVector);
  await db.execute(sql`
    insert into rag_embeddings (chunk_id, embedding, model)
    values
      (${oldChunk.id}, ${queryLiteral}::vector, 'gemini-embedding-001'),
      (${newChunk.id}, ${queryLiteral}::vector, 'gemini-embedding-2')
  `);

  const hits = await retrieveRagContext({
    queryText: "find matching RAG context",
    queryEmbedder: async () => [{ vector: queryVector, model: "gemini-embedding-2" }],
    organizationId: organization.id,
    limit: 10
  });

  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.chunkText, "new model chunk should be returned");
});

function unitVector1536(): number[] {
  const values = new Array(1536).fill(0);
  values[0] = 1;
  return values;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => value.toFixed(6)).join(",")}]`;
}

async function clearRagModelFilterArtifacts(suffix: string) {
  const db = getDb();
  await db.execute(sql`
    delete from rag_embeddings
    where chunk_id in (
      select c.id
      from rag_chunks c
      join rag_documents d on d.id = c.document_id
      where d.title in (${`t-rag-model-old-${suffix}`}, ${`t-rag-model-new-${suffix}`})
    )
  `);
  await db.execute(sql`
    delete from rag_chunks
    where document_id in (
      select id
      from rag_documents
      where title in (${`t-rag-model-old-${suffix}`}, ${`t-rag-model-new-${suffix}`})
    )
  `);
  await db
    .delete(ragDocuments)
    .where(sql`${ragDocuments.title} in (${`t-rag-model-old-${suffix}`}, ${`t-rag-model-new-${suffix}`})`);
  await db.delete(organizations).where(eq(organizations.name, `t-rag-model-${suffix}`));
}
