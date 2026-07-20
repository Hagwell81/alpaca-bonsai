/**
 * knowledgeBaseStore - Reactive State Store for Knowledge Base Operations
 *
 * Manages knowledge base collections, documents, search, and ingestion state.
 */

import { SvelteMap } from 'svelte/reactivity';
import { KnowledgeBaseService } from '$lib/services/knowledge-base.service';
import { toast } from 'svelte-sonner';
import type {
	KnowledgeBaseCollection,
	KnowledgeBaseDocument,
	KnowledgeBaseSearchResult
} from '$lib/types';

class KnowledgeBaseStore {
	collections = $state<KnowledgeBaseCollection[]>([]);
	activeCollectionId = $state<string | null>(null);
	searchResults = $state<KnowledgeBaseSearchResult[]>([]);
	isLoading = $state(false);
	isSearching = $state(false);

	private documentsMap = new SvelteMap<string, KnowledgeBaseDocument[]>();

	get activeCollection(): KnowledgeBaseCollection | null {
		return this.collections.find((c) => c.id === this.activeCollectionId) ?? null;
	}

	get documentsForActiveCollection(): KnowledgeBaseDocument[] {
		if (!this.activeCollectionId) return [];
		return this.documentsMap.get(this.activeCollectionId) ?? [];
	}

	/**
	 * Load all collections from the backend.
	 */
	async loadCollections(): Promise<void> {
		this.isLoading = true;
		try {
			const collections = await KnowledgeBaseService.getCollections();
			this.collections = collections;
		} catch (error) {
			console.error('Failed to load collections:', error);
			toast.error('Failed to load knowledge base collections');
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Create a new collection and refresh the list.
	 */
	async createCollection(name: string, description?: string): Promise<KnowledgeBaseCollection | null> {
		this.isLoading = true;
		try {
			const collection = await KnowledgeBaseService.createCollection(name, description);
			if (collection) {
				this.collections = [...this.collections, collection];
				toast.success(`Collection "${name}" created`);
				return collection;
			} else {
				toast.error('Failed to create collection');
				return null;
			}
		} catch (error) {
			console.error('Failed to create collection:', error);
			toast.error('Failed to create collection');
			return null;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Delete a collection and refresh the list.
	 */
	async deleteCollection(id: string): Promise<boolean> {
		this.isLoading = true;
		try {
			const success = await KnowledgeBaseService.deleteCollection(id);
			if (success) {
				this.collections = this.collections.filter((c) => c.id !== id);
				if (this.activeCollectionId === id) {
					this.activeCollectionId = null;
					this.searchResults = [];
				}
				toast.success('Collection deleted');
				return true;
			} else {
				toast.error('Failed to delete collection');
				return false;
			}
		} catch (error) {
			console.error('Failed to delete collection:', error);
			toast.error('Failed to delete collection');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Perform semantic search in the active collection.
	 */
	async search(query: string, topK = 5): Promise<void> {
		if (!this.activeCollectionId) {
			toast.error('No collection selected');
			return;
		}
		this.isSearching = true;
		try {
			const results = await KnowledgeBaseService.search(this.activeCollectionId, query, topK);
			this.searchResults = results;
		} catch (error) {
			console.error('Search failed:', error);
			toast.error('Search failed');
			this.searchResults = [];
		} finally {
			this.isSearching = false;
		}
	}

	/**
	 * Ingest files into the active collection.
	 */
	async ingestFiles(filePaths: string[]): Promise<void> {
		if (!this.activeCollectionId) {
			toast.error('No collection selected');
			return;
		}
		this.isLoading = true;
		try {
			const docs = await KnowledgeBaseService.ingestDocuments(this.activeCollectionId, filePaths);
			if (docs.length > 0) {
				this.documentsMap.set(this.activeCollectionId, [
					...(this.documentsMap.get(this.activeCollectionId) ?? []),
					...docs
				]);
				toast.success(`Ingested ${docs.length} document(s)`);
			} else {
				toast.error('No documents were ingested');
			}
		} catch (error) {
			console.error('Ingest failed:', error);
			toast.error('Failed to ingest documents');
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Ingest a URL into the active collection.
	 */
	async ingestUrl(url: string): Promise<void> {
		if (!this.activeCollectionId) {
			toast.error('No collection selected');
			return;
		}
		this.isLoading = true;
		try {
			const doc = await KnowledgeBaseService.ingestUrl(this.activeCollectionId, url);
			if (doc) {
				this.documentsMap.set(this.activeCollectionId, [
					...(this.documentsMap.get(this.activeCollectionId) ?? []),
					doc
				]);
				toast.success('URL ingested successfully');
			} else {
				toast.error('Failed to ingest URL');
			}
		} catch (error) {
			console.error('URL ingest failed:', error);
			toast.error('Failed to ingest URL');
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Load documents for a collection.
	 */
	async loadDocuments(collectionId: string): Promise<void> {
		this.isLoading = true;
		try {
			const documents = await KnowledgeBaseService.getDocuments(collectionId);
			this.documentsMap.set(collectionId, documents);
		} catch (error) {
			console.error('Failed to load documents:', error);
			toast.error('Failed to load documents');
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Delete a document from a collection.
	 */
	async deleteDocument(collectionId: string, docId: string): Promise<boolean> {
		this.isLoading = true;
		try {
			const success = await KnowledgeBaseService.deleteDocument(collectionId, docId);
			if (success) {
				const current = this.documentsMap.get(collectionId) ?? [];
				this.documentsMap.set(
					collectionId,
					current.filter((d) => d.id !== docId)
				);
				toast.success('Document deleted');
				return true;
			} else {
				toast.error('Failed to delete document');
				return false;
			}
		} catch (error) {
			console.error('Failed to delete document:', error);
			toast.error('Failed to delete document');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Set the active collection and load its documents.
	 */
	async setActiveCollection(id: string | null): Promise<void> {
		this.activeCollectionId = id;
		this.searchResults = [];
		if (id) {
			await this.loadDocuments(id);
		}
	}
}

export const knowledgeBaseStore = new KnowledgeBaseStore();
