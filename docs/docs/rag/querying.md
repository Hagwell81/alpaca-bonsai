# Querying the Knowledge Base

Search and retrieve information from your documents.

## Semantic Search

Enter natural language queries to find relevant document chunks.

## Retrieval Modes

- **Similarity**: Find semantically similar content
- **Keyword**: Exact and fuzzy keyword matching
- **Hybrid**: Combine semantic and keyword search

## Results

Results include:
- Relevance score
- Source document
- Surrounding context

## Chat Integration

Enable RAG in chat to automatically query the knowledge base.

## API

```bash
curl http://localhost:13434/v1/rag/query \
  -X POST \
  -d '{"query": "What is the API timeout?", "top_k": 5}'
```
