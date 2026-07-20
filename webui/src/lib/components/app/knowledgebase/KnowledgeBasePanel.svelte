<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { toast } from 'svelte-sonner';
	import {
		Search,
		Plus,
		Trash2,
		FolderOpen,
		Globe,
		FileText,
		Loader2,
		BookOpen,
		X
	} from '@lucide/svelte';
	import { knowledgeBaseStore } from '$lib/stores/knowledge-base.svelte';
	import type { KnowledgeBaseCollection, KnowledgeBaseDocument } from '$lib/types';

	// Create collection form
	let showCreateForm = $state(false);
	let newCollectionName = $state('');
	let newCollectionDescription = $state('');

	// URL ingest form
	let showUrlForm = $state(false);
	let ingestUrl = $state('');

	// Search
	let searchQuery = $state('');

	// File picker hidden input
	let fileInput: HTMLInputElement | null = $state(null);

	async function handleCreateCollection() {
		if (!newCollectionName.trim()) {
			toast.error('Collection name is required');
			return;
		}
		const collection = await knowledgeBaseStore.createCollection(
			newCollectionName.trim(),
			newCollectionDescription.trim() || undefined
		);
		if (collection) {
			newCollectionName = '';
			newCollectionDescription = '';
			showCreateForm = false;
		}
	}

	async function handleDeleteCollection(collection: KnowledgeBaseCollection) {
		if (!confirm(`Delete collection "${collection.name}"? This cannot be undone.`)) return;
		await knowledgeBaseStore.deleteCollection(collection.id);
	}

	async function handleSelectCollection(collection: KnowledgeBaseCollection) {
		await knowledgeBaseStore.setActiveCollection(collection.id);
	}

	async function handleSearch() {
		if (!searchQuery.trim()) return;
		await knowledgeBaseStore.search(searchQuery.trim());
	}

	async function handleIngestFiles(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		// In a real Electron environment, we'd get file paths. For now, simulate with names.
		const filePaths: string[] = Array.from(files).map((f) => f.name);
		await knowledgeBaseStore.ingestFiles(filePaths);
		if (fileInput) fileInput.value = '';
	}

	async function handleIngestUrl() {
		if (!ingestUrl.trim()) {
			toast.error('URL is required');
			return;
		}
		await knowledgeBaseStore.ingestUrl(ingestUrl.trim());
		ingestUrl = '';
		showUrlForm = false;
	}

	async function handleDeleteDocument(doc: KnowledgeBaseDocument) {
		if (!knowledgeBaseStore.activeCollectionId) return;
		if (!confirm(`Delete document "${doc.name}"?`)) return;
		await knowledgeBaseStore.deleteDocument(knowledgeBaseStore.activeCollectionId, doc.id);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}
</script>

<div class="flex h-full flex-col overflow-hidden border-l border-border/30 bg-background">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-border/30 px-4 py-3">
		<div class="flex items-center gap-2">
			<BookOpen class="h-4 w-4 text-muted-foreground" />
			<h2 class="text-sm font-semibold">Knowledge Base</h2>
		</div>
		<Button variant="ghost" size="icon-sm" onclick={() => knowledgeBaseStore.loadCollections()} title="Refresh">
			<Loader2 class="h-4 w-4 {knowledgeBaseStore.isLoading ? 'animate-spin' : ''}" />
		</Button>
	</div>

	<div class="flex flex-1 overflow-hidden">
		<!-- Collections Sidebar -->
		<div class="flex w-56 flex-col border-r border-border/30">
			<div class="flex items-center justify-between px-3 py-2">
				<span class="text-xs font-medium text-muted-foreground">Collections</span>
				<Button variant="ghost" size="icon-sm" onclick={() => (showCreateForm = !showCreateForm)}>
					<Plus class="h-3.5 w-3.5" />
				</Button>
			</div>

			{#if showCreateForm}
				<div class="space-y-2 px-3 py-2">
					<Input
						placeholder="Name"
						bind:value={newCollectionName}
						class="h-7 text-xs"
					/>
					<Input
						placeholder="Description (optional)"
						bind:value={newCollectionDescription}
						class="h-7 text-xs"
					/>
					<div class="flex gap-1">
						<Button size="sm" class="h-6 text-xs" onclick={handleCreateCollection}>Create</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-6 text-xs"
							onclick={() => (showCreateForm = false)}
						>
							Cancel
						</Button>
					</div>
				</div>
			{/if}

			<ScrollArea class="flex-1">
				<div class="space-y-0.5 p-2">
					{#each knowledgeBaseStore.collections as collection (collection.id)}
						<button
							class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors {knowledgeBaseStore.activeCollectionId ===
							collection.id
								? 'bg-accent text-accent-foreground'
								: 'hover:bg-muted text-muted-foreground'}"
							onclick={() => handleSelectCollection(collection)}
						>
							<div class="flex flex-col truncate">
								<span class="truncate font-medium">{collection.name}</span>
								<span class="truncate text-[10px] opacity-70">
									{collection.documentCount} document{collection.documentCount === 1 ? '' : 's'}
								</span>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								class="h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100"
								onclick={(e) => {
									e.stopPropagation();
									handleDeleteCollection(collection);
								}}
							>
								<Trash2 class="h-3 w-3 text-destructive" />
							</Button>
						</button>
					{:else}
						<div class="px-2 py-4 text-center text-xs text-muted-foreground">
							No collections yet
						</div>
					{/each}
				</div>
			</ScrollArea>
		</div>

		<!-- Main Content -->
		<div class="flex flex-1 flex-col overflow-hidden">
			{#if knowledgeBaseStore.activeCollection}
				<!-- Active Collection Header -->
				<div class="border-b border-border/30 px-4 py-3">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-sm font-medium">{knowledgeBaseStore.activeCollection.name}</h3>
							<p class="text-xs text-muted-foreground">
								{knowledgeBaseStore.activeCollection.description || 'No description'}
							</p>
						</div>
						<div class="flex gap-1">
							<Button
								variant="outline"
								size="sm"
								class="h-7 gap-1 text-xs"
								onclick={() => fileInput?.click()}
							>
								<FolderOpen class="h-3.5 w-3.5" />
								Files
							</Button>
							<input
								bind:this={fileInput}
								type="file"
								multiple
								class="hidden"
								onchange={handleIngestFiles}
							/>
							<Button
								variant="outline"
								size="sm"
								class="h-7 gap-1 text-xs"
								onclick={() => (showUrlForm = !showUrlForm)}
							>
								<Globe class="h-3.5 w-3.5" />
								URL
							</Button>
						</div>
					</div>

					{#if showUrlForm}
						<div class="mt-2 flex gap-2">
							<Input
								placeholder="https://example.com/document"
								bind:value={ingestUrl}
								class="h-7 text-xs"
								onkeydown={handleKeyDown}
							/>
							<Button size="sm" class="h-7 text-xs" onclick={handleIngestUrl}>
								Ingest
							</Button>
							<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={() => (showUrlForm = false)}>
								Cancel
							</Button>
						</div>
					{/if}

					<!-- Search -->
					<div class="mt-2 flex gap-2">
						<Input
							placeholder="Search documents..."
							bind:value={searchQuery}
							class="h-7 text-xs"
							onkeydown={handleKeyDown}
						/>
						<Button
							size="sm"
							class="h-7 gap-1 text-xs"
							onclick={handleSearch}
							disabled={knowledgeBaseStore.isSearching}
						>
							{#if knowledgeBaseStore.isSearching}
								<Loader2 class="h-3.5 w-3.5 animate-spin" />
							{:else}
								<Search class="h-3.5 w-3.5" />
							{/if}
							Search
						</Button>
					</div>
				</div>

				<!-- Search Results -->
				{#if knowledgeBaseStore.searchResults.length > 0}
					<div class="border-b border-border/30 px-4 py-2">
						<div class="mb-1 flex items-center justify-between">
							<span class="text-xs font-medium text-muted-foreground">Search Results</span>
							<Button
								variant="ghost"
								size="icon-sm"
								class="h-5 w-5"
								onclick={() => (knowledgeBaseStore.searchResults = [])}
							>
								<X class="h-3 w-3" />
							</Button>
						</div>
						<ScrollArea class="max-h-48">
							<div class="space-y-2">
								{#each knowledgeBaseStore.searchResults as result (result.chunkId)}
									<div class="rounded-md bg-muted/50 p-2 text-xs">
										<div class="mb-1 flex items-center justify-between">
											<span class="font-medium">{result.documentName}</span>
											<span class="text-[10px] text-muted-foreground">
												Score: {result.score.toFixed(3)}
											</span>
										</div>
										<p class="line-clamp-3 text-muted-foreground">{result.content}</p>
									</div>
								{/each}
							</div>
						</ScrollArea>
					</div>
				{/if}

				<!-- Documents List -->
				<ScrollArea class="flex-1">
					<div class="divide-y divide-border/30">
						{#each knowledgeBaseStore.documentsForActiveCollection as doc (doc.id)}
							<div class="flex items-center justify-between px-4 py-2 hover:bg-muted/50">
								<div class="flex items-center gap-2 overflow-hidden">
									<FileText class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
									<div class="min-w-0">
										<p class="truncate text-xs font-medium">{doc.name}</p>
										<p class="text-[10px] text-muted-foreground">
											{doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'}
											{#if doc.url}
												· {doc.url}
											{/if}
										</p>
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon-sm"
									class="h-6 w-6 flex-shrink-0"
									onclick={() => handleDeleteDocument(doc)}
								>
									<Trash2 class="h-3 w-3 text-destructive" />
								</Button>
							</div>
						{:else}
							<div class="px-4 py-8 text-center text-xs text-muted-foreground">
								No documents in this collection
							</div>
						{/each}
					</div>
				</ScrollArea>
			{:else}
				<div class="flex flex-1 items-center justify-center">
					<div class="text-center">
						<BookOpen class="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
						<p class="text-sm text-muted-foreground">Select a collection to get started</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
