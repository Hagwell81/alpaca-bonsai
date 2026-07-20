# Vector Stores

Understanding vector storage for RAG.

## What is a Vector Store?

A database that stores document embeddings for semantic search.

## Supported Backends

- **SQLite**: Default, file-based
- **ChromaDB**: Dedicated vector database
- **Weaviate**: Cloud and self-hosted
- **Qdrant**: High-performance

## Configuration

```json
{
  "rag": {
    "vectorStore": "sqlite",
    "embeddingModel": "all-MiniLM-L6-v2",
    "chunkSize": 512,
    "overlap": 50
  }
}
```

## Embeddings

Documents are converted to vector embeddings for similarity search.

## Indexing

New documents are automatically indexed after ingestion.
