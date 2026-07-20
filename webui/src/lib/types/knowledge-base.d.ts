/**
 * Knowledge Base types for document collections, search, and chunk management.
 */

export interface KnowledgeBaseCollection {
	id: string;
	name: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	documentCount: number;
}

export interface KnowledgeBaseDocument {
	id: string;
	collectionId: string;
	name: string;
	path?: string;
	url?: string;
	size?: number;
	createdAt: number;
	chunkCount: number;
}

export interface KnowledgeBaseSearchResult {
	documentId: string;
	documentName: string;
	chunkId: string;
	content: string;
	score: number;
}

export interface KnowledgeBaseChunk {
	id: string;
	documentId: string;
	collectionId: string;
	content: string;
	index: number;
	metadata?: Record<string, unknown>;
}
