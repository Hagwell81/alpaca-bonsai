# Adding Documents

Add documents to the RAG knowledge base.

## Supported Formats

- Markdown (.md)
- Text files (.txt)
- PDF documents (.pdf)
- Word documents (.docx)
- Code files (.js, .py, .ts, etc.)

## Methods

### Drag and Drop

Drag files directly into the knowledge base panel.

### File Picker

1. Open Knowledge Base panel
2. Click "Add Documents"
3. Select files or folders
4. Wait for indexing

### API

```bash
curl -X POST http://localhost:13434/v1/rag/documents \
  -H "Content-Type: multipart/form-data" \
  -F "file=@document.pdf"
```

## Chunking

Documents are automatically chunked into manageable pieces for retrieval.

## Metadata

Add tags and metadata to documents for better search.
