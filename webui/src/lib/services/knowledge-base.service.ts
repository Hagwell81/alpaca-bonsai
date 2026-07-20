/**
 * KnowledgeBaseService - Stateless client for knowledge base operations.
 *
 * Wraps window.llamaAPI knowledge base methods to provide collection
 * management, document ingestion, and semantic search functionality.
 */

import type {
	KnowledgeBaseCollection,
	KnowledgeBaseDocument,
	KnowledgeBaseSearchResult
} from '$lib/types';

export class KnowledgeBaseService {
	/**
	 * Get all knowledge base collections.
	 */
	static async getCollections(): Promise<KnowledgeBaseCollection[]> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbGetCollections) return [];
			const res = await api.kbGetCollections();
			return res.success ? (res.collections ?? []) : [];
		} catch {
			return [];
		}
	}

	/**
	 * Create a new knowledge base collection.
	 */
	static async createCollection(
		name: string,
		description?: string
	): Promise<KnowledgeBaseCollection | null> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbCreateCollection) return null;
			const res = await api.kbCreateCollection(name, description);
			return res.success ? (res.collection ?? null) : null;
		} catch {
			return null;
		}
	}

	/**
	 * Delete a knowledge base collection by ID.
	 */
	static async deleteCollection(id: string): Promise<boolean> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbDeleteCollection) return false;
			const res = await api.kbDeleteCollection(id);
			return res.success ?? false;
		} catch {
			return false;
		}
	}

	/**
	 * Ingest document files into a collection.
	 *
	 * @param collectionId - Target collection ID
	 * @param files - Array of file paths to ingest
	 */
	static async ingestDocuments(
		collectionId: string,
		files: string[]
	): Promise<KnowledgeBaseDocument[]> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbIngestDocuments) return [];
			const res = await api.kbIngestDocuments(collectionId, files);
			return res.success ? (res.documents ?? []) : [];
		} catch {
			return [];
		}
	}

	/**
	 * Ingest a URL into a collection.
	 */
	static async ingestUrl(collectionId: string, url: string): Promise<KnowledgeBaseDocument | null> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbIngestUrl) return null;
			const res = await api.kbIngestUrl(collectionId, url);
			return res.success ? (res.document ?? null) : null;
		} catch {
			return null;
		}
	}

	/**
	 * Perform semantic search within a collection.
	 */
	static async search(
		collectionId: string,
		query: string,
		topK = 5
	): Promise<KnowledgeBaseSearchResult[]> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbSearch) return [];
			const res = await api.kbSearch(collectionId, query, topK);
			return res.success ? (res.results ?? []) : [];
		} catch {
			return [];
		}
	}

	/**
	 * Get all documents in a collection.
	 */
	static async getDocuments(collectionId: string): Promise<KnowledgeBaseDocument[]> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbGetDocuments) return [];
			const res = await api.kbGetDocuments(collectionId);
			return res.success ? (res.documents ?? []) : [];
		} catch {
			return [];
		}
	}

	/**
	 * Delete a document from a collection.
	 */
	static async deleteDocument(collectionId: string, docId: string): Promise<boolean> {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.kbDeleteDocument) return false;
			const res = await api.kbDeleteDocument(collectionId, docId);
			return res.success ?? false;
		} catch {
			return false;
		}
	}
}
