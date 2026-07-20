<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Search, Globe, Loader2, Copy, ExternalLink, Code, Folder, FolderOpen, Database, AlertCircle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	let open = $state(false);
	interface Props {
		onAddContext?: (content: string) => void;
	}

	let { onAddContext }: Props = $props();

	// Active tab: 'web' | 'local'
	let activeTab = $state<'web' | 'local'>('web');

	// --- Web Search State ---
	let query = $state('');
	let isSearching = $state(false);
	let results = $state<Array<{ title: string; url: string; snippet: string }>>([]);
	let selectedResultIndex = $state<number | null>(null);
	let fetchedContent = $state('');
	let isFetching = $state(false);

	// jcodemunch code search state (web repos)
	let codeResults = $state<Array<{ symbol_id: string; name: string; kind: string; file_path: string; signature?: string; summary?: string }>>([]);
	let isIndexing = $state(false);
	let isCodeSearching = $state(false);
	let selectedSymbolIndex = $state<number | null>(null);
	let symbolSource = $state('');
	let isFetchingSource = $state(false);
	let currentRepo = $state('');
	let codeSearchError = $state('');

	// --- Local Workspace State ---
	let localQuery = $state('');
	let indexedRepos = $state<Array<{ name: string; type: string }>>([]);
	let isLoadingRepos = $state(false);
	let selectedLocalRepo = $state('');
	let localCodeResults = $state<Array<{ symbol_id: string; name: string; kind: string; file_path: string; signature?: string; summary?: string }>>([]);
	let isLocalSearching = $state(false);
	let selectedLocalSymbolIndex = $state<number | null>(null);
	let localSymbolSource = $state('');
	let isFetchingLocalSource = $state(false);
	let localSearchError = $state('');
	let isSelectingFolder = $state(false);
	let isIndexingFolder = $state(false);

	// jCodeMunch availability check
	let jcmAvailable = $state<boolean | null>(null);
	let jcmError = $state('');

	function isGitHubRepoUrl(url: string): boolean {
		return /^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(url);
	}

	function extractRepoId(url: string): string | null {
		const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
		return match ? match[1] : null;
	}

	async function checkJcmAvailability() {
		try {
			const api = window.llamaAPI;
			if (!api?.jcmHealthCheck) {
				jcmAvailable = false;
				jcmError = 'Built-in code retrieval is not available in this build';
				return;
			}
			const res = await api.jcmHealthCheck();
			jcmAvailable = res.available;
			jcmError = res.error || '';
		} catch (err) {
			jcmAvailable = false;
			jcmError = err instanceof Error ? err.message : 'Code retrieval unavailable';
		}
	}

	async function handleSearch() {
		if (!query.trim() || isSearching) return;
		isSearching = true;
		results = [];
		selectedResultIndex = null;
		fetchedContent = '';
		clearCodeState();
		try {
			const api = window.llamaAPI;
			if (!api?.webSearch) {
				toast.error('Web search is not available');
				return;
			}
			const res = await api.webSearch(query.trim(), 5);
			if (res.success && res.results) {
				results = res.results;
			} else {
				toast.error(res.error || 'Search failed');
			}
		} catch (err) {
			console.error('Web search error:', err);
			toast.error('Failed to perform web search');
		} finally {
			isSearching = false;
		}
	}

	function clearCodeState() {
		codeResults = [];
		symbolSource = '';
		selectedSymbolIndex = null;
		currentRepo = '';
		codeSearchError = '';
	}

	async function handleFetchPage(url: string, index: number) {
		selectedResultIndex = index;
		isFetching = true;
		fetchedContent = '';
		clearCodeState();
		try {
			const api = window.llamaAPI;
			if (!api?.fetchWebPage) {
				toast.error('Page fetch is not available');
				return;
			}
			const res = await api.fetchWebPage(url);
			if (res.success) {
				fetchedContent = res.content || '';
			} else {
				toast.error(res.error || 'Failed to fetch page');
			}
		} catch (err) {
			console.error('Fetch page error:', err);
			toast.error('Failed to fetch page content');
		} finally {
			isFetching = false;
		}
	}

	async function handleCodeSearch(url: string, index: number) {
		selectedResultIndex = index;
		fetchedContent = '';
		clearCodeState();

		const repoId = extractRepoId(url);
		if (!repoId) {
			toast.error('Could not extract repository ID from URL');
			return;
		}
		// Narrow to non-null string for TypeScript
		const repo = repoId;

		await checkJcmAvailability();
		if (!jcmAvailable) {
			toast.error(jcmError || 'Code retrieval unavailable. Install Python 3.10+ and run: pip install jcodemunch-mcp');
			return;
		}

		const api = window.llamaAPI;
		if (!api) {
			toast.error('API not available');
			return;
		}
		isIndexing = true;
		try {
			const indexRes = await api.jcmIndexRepo(repo);
			if (!indexRes.success) {
				console.warn('[WebSearch] index_repo warning:', indexRes.error);
			}
		} catch (err) {
			console.warn('[WebSearch] index_repo error:', err);
		} finally {
			isIndexing = false;
		}

		isCodeSearching = true;
		currentRepo = repo;
		try {
			const searchQuery = query || '';
			const searchRes = await api.jcmSearchSymbols(repo, searchQuery.trim(), 10);
			if (!searchRes.success) {
				codeSearchError = searchRes.error || 'Symbol search failed';
				return;
			}
			if (searchRes.content) {
				parseCodeResults(searchRes.content);
			}
		} catch (err) {
			console.error('Code search error:', err);
			codeSearchError = err instanceof Error ? err.message : 'Code search failed';
		} finally {
			isCodeSearching = false;
		}
	}

	function parseCodeResults(content: string) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch {
			codeSearchError = 'Invalid symbol search response';
			return;
		}
		const extract = (items: unknown[]) =>
			(items as Array<Record<string, unknown>>).map((s) => ({
				symbol_id: String(s.symbol_id ?? s.id ?? ''),
				name: String(s.name ?? ''),
				kind: String(s.kind ?? ''),
				file_path: String(s.file_path ?? s.path ?? ''),
				signature: s.signature ? String(s.signature) : undefined,
				summary: s.summary ? String(s.summary) : undefined
			})).filter((s) => s.symbol_id);

		if (Array.isArray(parsed)) {
			codeResults = extract(parsed);
		} else if (parsed && typeof parsed === 'object' && 'results' in parsed && Array.isArray(parsed.results)) {
			codeResults = extract(parsed.results);
		} else {
			codeSearchError = 'Unexpected symbol search response format';
		}
	}

	async function handleFetchSymbolSource(symbolId: string, index: number) {
		selectedSymbolIndex = index;
		isFetchingSource = true;
		symbolSource = '';
		try {
			const api = window.llamaAPI;
			if (!api) {
				toast.error('API not available');
				return;
			}
			const res = await api.jcmGetSymbolSource(currentRepo || '', symbolId);
			if (!res.success) {
				toast.error(res.error || 'Failed to fetch symbol source');
				return;
			}
			if (res.content) {
				symbolSource = extractSourceFromContent(res.content);
			} else {
				symbolSource = '';
			}
		} catch (err) {
			console.error('Fetch symbol source error:', err);
			toast.error('Failed to fetch symbol source');
		} finally {
			isFetchingSource = false;
		}
	}

	function extractSourceFromContent(content: string): string {
		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch {
			return content;
		}
		if (parsed && typeof parsed === 'object' && parsed !== null) {
			if ('source' in parsed && typeof parsed.source === 'string') {
				return parsed.source;
			} else if ('symbols' in parsed && Array.isArray(parsed.symbols) && parsed.symbols.length > 0) {
				const first = parsed.symbols[0];
				return first.source ?? first.content ?? JSON.stringify(first, null, 2);
			}
			return JSON.stringify(parsed, null, 2);
		}
		return String(parsed);
	}

	// --- Local Workspace Functions ---

	async function loadIndexedRepos() {
		isLoadingRepos = true;
		await checkJcmAvailability();
		if (!jcmAvailable) {
			isLoadingRepos = false;
			return;
		}
		try {
			const api = window.llamaAPI;
			if (!api) {
				isLoadingRepos = false;
				return;
			}
			const res = await api.jcmListRepos();
			if (res.success && res.content) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(res.content);
				} catch {
					parsed = [];
				}
				if (Array.isArray(parsed)) {
					indexedRepos = parsed.map((r: Record<string, unknown>) => ({
						name: String(r.name ?? r.repo ?? r.id ?? 'unknown'),
						type: String(r.type ?? r.source_type ?? 'repo')
					}));
				} else if (parsed && typeof parsed === 'object' && 'repos' in parsed && Array.isArray(parsed.repos)) {
					indexedRepos = parsed.repos.map((r: Record<string, unknown>) => ({
						name: String(r.name ?? r.repo ?? r.id ?? 'unknown'),
						type: String(r.type ?? r.source_type ?? 'repo')
					}));
				} else {
					indexedRepos = [];
				}
			} else {
				indexedRepos = [];
			}
		} catch (err) {
			console.error('Failed to list repos:', err);
			indexedRepos = [];
		} finally {
			isLoadingRepos = false;
		}
	}

	async function handleSelectFolder() {
		isSelectingFolder = true;
		try {
			const api = window.llamaAPI;
			if (!api?.selectLocalFolder) {
				toast.error('Folder picker not available');
				return;
			}
			const res = await api.selectLocalFolder();
			if (res.canceled || !res.folderPath) {
				return;
			}
			isIndexingFolder = true;
			const indexRes = await api.jcmIndexFolder(res.folderPath);
			if (indexRes.success) {
				toast.success(`Indexed folder: ${res.folderPath}`);
				await loadIndexedRepos();
				// Auto-select the newly indexed folder
				const folderName = res.folderPath.split(/[\\/]/).pop() || res.folderPath;
				const matched = indexedRepos.find((r) => r.name === folderName || r.name === res.folderPath);
				if (matched) {
					selectedLocalRepo = matched.name;
				}
			} else {
				toast.error(indexRes.error || 'Failed to index folder');
			}
		} catch (err) {
			console.error('Folder selection error:', err);
			toast.error(err instanceof Error ? err.message : 'Failed to select or index folder');
		} finally {
			isSelectingFolder = false;
			isIndexingFolder = false;
		}
	}

	async function handleLocalSearch() {
		if (!localQuery.trim() || !selectedLocalRepo || isLocalSearching) return;
		isLocalSearching = true;
		localCodeResults = [];
		localSymbolSource = '';
		selectedLocalSymbolIndex = null;
		localSearchError = '';
		try {
			const api = window.llamaAPI;
			if (!api) {
				localSearchError = 'API not available';
				isLocalSearching = false;
				return;
			}
			const lq = localQuery || '';
			const res = await api.jcmSearchSymbols(selectedLocalRepo || '', lq.trim(), 10);
			if (!res.success) {
				localSearchError = res.error || 'Symbol search failed';
				return;
			}
			if (!res.content) {
				localSearchError = 'Empty response';
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(res.content);
			} catch {
				localSearchError = 'Invalid response';
				return;
			}
			const extract = (items: unknown[]) =>
				(items as Array<Record<string, unknown>>).map((s) => ({
					symbol_id: String(s.symbol_id ?? s.id ?? ''),
					name: String(s.name ?? ''),
					kind: String(s.kind ?? ''),
					file_path: String(s.file_path ?? s.path ?? ''),
					signature: s.signature ? String(s.signature) : undefined,
					summary: s.summary ? String(s.summary) : undefined
				})).filter((s) => s.symbol_id);
			if (Array.isArray(parsed)) {
				localCodeResults = extract(parsed);
			} else if (parsed && typeof parsed === 'object' && 'results' in parsed && Array.isArray(parsed.results)) {
				localCodeResults = extract(parsed.results);
			} else {
				localSearchError = 'Unexpected response format';
			}
		} catch (err) {
			console.error('Local search error:', err);
			localSearchError = err instanceof Error ? err.message : 'Search failed';
		} finally {
			isLocalSearching = false;
		}
	}

	async function handleFetchLocalSymbolSource(symbolId: string, index: number) {
		selectedLocalSymbolIndex = index;
		isFetchingLocalSource = true;
		localSymbolSource = '';
		try {
			const api = window.llamaAPI;
			if (!api) {
				toast.error('API not available');
				return;
			}
			const res = await api.jcmGetSymbolSource(selectedLocalRepo || '', symbolId);
			if (!res.success) {
				toast.error(res.error || 'Failed to fetch symbol source');
				return;
			}
			if (res.content) {
				localSymbolSource = extractSourceFromContent(res.content);
			} else {
				localSymbolSource = '';
			}
		} catch (err) {
			console.error('Fetch local symbol error:', err);
			toast.error('Failed to fetch symbol source');
		} finally {
			isFetchingLocalSource = false;
		}
	}

	// HTML-attribute escaping for the <web_context> wrapper attributes.
	// Body content is left as-is so the model sees the original text.
	function escAttr(s: string): string {
		return String(s ?? '')
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	// Wraps fetched context in a sentinel tag the chat UI can recognise and
	// render as an expandable block (similar to reasoning blocks for the
	// assistant). The model still receives the full body as plain text inside
	// the tag, so context is preserved.
	function wrapContext(opts: {
		kind: 'web-page' | 'web-search' | 'code';
		title: string;
		url?: string;
		body: string;
	}): string {
		const attrs = [
			`kind="${escAttr(opts.kind)}"`,
			`title="${escAttr(opts.title)}"`,
			opts.url ? `url="${escAttr(opts.url)}"` : ''
		]
			.filter(Boolean)
			.join(' ');
		return `<web_context ${attrs}>\n${opts.body}\n</web_context>\n\n`;
	}

	function formatForContext(): string {
		if (symbolSource && currentRepo) {
			const sym = codeResults[selectedSymbolIndex!];
			const title = `${sym?.name ?? 'Symbol'} — ${currentRepo}`;
			const body = `Symbol: ${sym?.name ?? ''} (${sym?.kind ?? ''})\nFile: ${sym?.file_path ?? ''}\n\n${symbolSource}`;
			return wrapContext({ kind: 'code', title, body });
		}
		if (localSymbolSource && selectedLocalRepo) {
			const sym = localCodeResults[selectedLocalSymbolIndex!];
			const title = `${sym?.name ?? 'Symbol'} — ${selectedLocalRepo}`;
			const body = `Symbol: ${sym?.name ?? ''} (${sym?.kind ?? ''})\nFile: ${sym?.file_path ?? ''}\n\n${localSymbolSource}`;
			return wrapContext({ kind: 'code', title, body });
		}
		if (fetchedContent) {
			const r = results[selectedResultIndex!];
			const title = r?.title || 'Web page';
			const url = r?.url || '';
			const body = `Title: ${title}\nURL: ${url}\n\n${fetchedContent}`;
			return wrapContext({ kind: 'web-page', title, url, body });
		}
		if (results.length > 0) {
			const body = `Web search results for "${query}":\n\n${results
				.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
				.join('\n\n')}`;
			return wrapContext({ kind: 'web-search', title: `Search: ${query}`, body });
		}
		return '';
	}

	export function triggerOpen() {
		open = true;
		checkJcmAvailability();
		loadIndexedRepos();
	}

	export function getContextText(): string {
		return formatForContext();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[720px] max-h-[85vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{#if activeTab === 'web'}
					<Globe class="h-5 w-5" />
					Web Search
				{:else}
					<Folder class="h-5 w-5" />
					Local Workspace
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if activeTab === 'web'}
					Search the web and use results as context for your chat.
				{:else}
					Browse and search indexed local folders and repositories for code context.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<!-- Tab Bar -->
		<div class="flex border-b border-border">
			<button
				type="button"
				class="flex-1 py-2 text-sm font-medium transition-colors {activeTab === 'web' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => { activeTab = 'web'; }}
			>
				<Globe class="h-4 w-4 inline mr-1" />
				Web Search
			</button>
			<button
				type="button"
				class="flex-1 py-2 text-sm font-medium transition-colors {activeTab === 'local' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => { activeTab = 'local'; loadIndexedRepos(); }}
			>
				<Folder class="h-4 w-4 inline mr-1" />
				Local Workspace
			</button>
		</div>

		<div class="flex-1 overflow-y-auto space-y-2 min-h-0 py-2">
			{#if activeTab === 'web'}
				<!-- Web Search Tab -->
				<div class="flex gap-2">
					<Input
						bind:value={query}
						placeholder="Search query..."
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); }}
					/>
					<Button onclick={handleSearch} disabled={isSearching || !query.trim()}>
						{#if isSearching}
							<Loader2 class="h-4 w-4 animate-spin" />
						{:else}
							<Search class="h-4 w-4" />
						{/if}
						Search
					</Button>
				</div>

				{#if results.length > 0}
					{#each results as result, index}
						<button
							type="button"
							class="w-full text-left rounded-lg border p-3 cursor-pointer transition-colors {selectedResultIndex === index ? 'bg-muted border-primary' : 'hover:bg-muted/50'}"
							onclick={() => handleFetchPage(result.url, index)}
						>
							<div class="flex items-start justify-between gap-2">
								<div class="flex-1 min-w-0">
									<p class="font-medium text-sm truncate">{result.title}</p>
									<p class="text-xs text-muted-foreground truncate">{result.url}</p>
								</div>
								<div class="flex items-center gap-1 shrink-0">
									{#if jcmAvailable && isGitHubRepoUrl(result.url)}
										<Button
											variant="ghost"
											size="sm"
											class="h-6 w-6 p-0"
											type="button"
											onclick={(e) => { e.stopPropagation(); handleCodeSearch(result.url, index); }}
											disabled={isIndexing || isCodeSearching}
											title="Search code in repository"
										>
											<Code class="h-3 w-3" />
										</Button>
									{/if}
									<ExternalLink class="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
								</div>
							</div>
							{#if result.snippet}
								<p class="text-xs text-muted-foreground mt-1 line-clamp-2">{result.snippet}</p>
							{/if}
						</button>
					{/each}
				{:else if !isSearching && query.trim()}
					<p class="text-sm text-muted-foreground text-center py-4">No results found.</p>
				{/if}

				{#if isFetching}
					<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						Fetching page content...
					</div>
				{/if}

				{#if isIndexing}
					<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						Indexing repository with jCodeMunch...
					</div>
				{/if}

				{#if isCodeSearching}
					<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						Searching symbols...
					</div>
				{/if}

				{#if codeSearchError}
					<div class="rounded-lg border border-destructive/50 bg-destructive/10 p-3 mt-2">
						<p class="text-xs text-destructive font-medium">Code search error:</p>
						<p class="text-xs text-destructive/80">{codeSearchError}</p>
					</div>
				{/if}

				{#if codeResults.length > 0}
					<div class="mt-2 space-y-1">
						<p class="text-xs font-medium">Code Search Results ({currentRepo}):</p>
						{#each codeResults as symbol, symIndex}
							<button
								type="button"
								class="w-full text-left rounded-md border p-2 cursor-pointer transition-colors text-xs {selectedSymbolIndex === symIndex ? 'bg-muted border-primary' : 'hover:bg-muted/50'}"
								onclick={() => handleFetchSymbolSource(symbol.symbol_id, symIndex)}
							>
								<div class="flex items-center justify-between gap-1">
									<span class="font-medium truncate">{symbol.name}</span>
									<span class="text-[10px] text-muted-foreground shrink-0">{symbol.kind}</span>
								</div>
								<p class="text-[10px] text-muted-foreground truncate">{symbol.file_path}</p>
								{#if symbol.summary}
									<p class="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{symbol.summary}</p>
								{/if}
							</button>
						{/each}
					</div>
				{/if}

				{#if isFetchingSource}
					<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						Fetching symbol source...
					</div>
				{/if}

				{#if symbolSource}
					<div class="rounded-lg bg-muted p-3 mt-2">
						<p class="text-xs font-medium mb-1">Symbol Source:</p>
						<pre class="text-xs text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap">{symbolSource}</pre>
					</div>
				{/if}

				{#if fetchedContent}
					<div class="rounded-lg bg-muted p-3 mt-2">
						<p class="text-xs font-medium mb-1">Page Content:</p>
						<p class="text-xs text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap">{fetchedContent}</p>
					</div>
				{/if}
			{:else}
				<!-- Local Workspace Tab -->
				{#if jcmAvailable === false}
					<div class="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
						<div class="flex items-start gap-2">
							<AlertCircle class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
							<div>
								<p class="text-xs text-destructive font-medium">Code retrieval unavailable</p>
								<p class="text-xs text-destructive/80">{jcmError || 'Install Python 3.10+ and run: pip install jcodemunch-mcp'}</p>
							</div>
						</div>
					</div>
				{/if}

				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						disabled={isSelectingFolder || jcmAvailable === false}
						onclick={handleSelectFolder}
						class="shrink-0"
					>
						{#if isSelectingFolder || isIndexingFolder}
							<Loader2 class="h-4 w-4 animate-spin mr-1" />
						{:else}
							<FolderOpen class="h-4 w-4 mr-1" />
						{/if}
						Select Folder
					</Button>
					{#if isIndexingFolder}
						<span class="text-xs text-muted-foreground">Indexing folder...</span>
					{/if}
				</div>

				{#if indexedRepos.length > 0}
					<div class="space-y-2">
						<div class="flex items-center gap-2">
							<Database class="h-4 w-4 text-muted-foreground" />
							<p class="text-xs font-medium">Indexed Repositories / Folders</p>
						</div>
						<div class="flex flex-wrap gap-1">
							{#each indexedRepos as repo}
								<button
									type="button"
									class="text-xs rounded-md border px-2 py-1 transition-colors {selectedLocalRepo === repo.name ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}"
									onclick={() => { selectedLocalRepo = repo.name; }}
								>
									{repo.name}
									<span class="opacity-70">({repo.type})</span>
								</button>
							{/each}
						</div>
					</div>
				{:else if isLoadingRepos}
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 class="h-4 w-4 animate-spin" />
						Loading indexed repositories...
					</div>
				{:else if jcmAvailable}
					<p class="text-xs text-muted-foreground text-center py-2">No indexed repositories yet. Select a folder to index.</p>
				{/if}

				{#if selectedLocalRepo}
					<div class="flex gap-2 pt-2 border-t border-border">
						<Input
							bind:value={localQuery}
							placeholder={`Search symbols in ${selectedLocalRepo}...`}
							onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleLocalSearch(); }}
						/>
						<Button onclick={handleLocalSearch} disabled={isLocalSearching || !localQuery.trim()}>
							{#if isLocalSearching}
								<Loader2 class="h-4 w-4 animate-spin" />
							{:else}
								<Search class="h-4 w-4" />
							{/if}
							Search
						</Button>
					</div>
				{/if}

				{#if isLocalSearching}
					<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						Searching symbols in {selectedLocalRepo}...
					</div>
				{/if}

				{#if localSearchError}
					<div class="rounded-lg border border-destructive/50 bg-destructive/10 p-3 mt-2">
						<p class="text-xs text-destructive font-medium">Search error:</p>
						<p class="text-xs text-destructive/80">{localSearchError}</p>
					</div>
				{/if}

				{#if localCodeResults.length > 0}
					<div class="mt-2 space-y-1">
						<p class="text-xs font-medium">Code Search Results ({selectedLocalRepo}):</p>
						{#each localCodeResults as symbol, symIndex}
							<button
								type="button"
								class="w-full text-left rounded-md border p-2 cursor-pointer transition-colors text-xs {selectedLocalSymbolIndex === symIndex ? 'bg-muted border-primary' : 'hover:bg-muted/50'}"
								onclick={() => handleFetchLocalSymbolSource(symbol.symbol_id, symIndex)}
							>
								<div class="flex items-center justify-between gap-1">
									<span class="font-medium truncate">{symbol.name}</span>
									<span class="text-[10px] text-muted-foreground shrink-0">{symbol.kind}</span>
								</div>
								<p class="text-[10px] text-muted-foreground truncate">{symbol.file_path}</p>
								{#if symbol.summary}
									<p class="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{symbol.summary}</p>
								{/if}
							</button>
						{/each}
					</div>
				{/if}

				{#if isFetchingLocalSource}
					<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						Fetching symbol source...
					</div>
				{/if}

				{#if localSymbolSource}
					<div class="rounded-lg bg-muted p-3 mt-2">
						<p class="text-xs font-medium mb-1">Symbol Source:</p>
						<pre class="text-xs text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap">{localSymbolSource}</pre>
					</div>
				{/if}
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2 pt-2">
			<Button variant="outline" class="ml-auto" onclick={() => { open = false; }}>Close</Button>
			<Button
				disabled={!formatForContext()}
				onclick={() => {
					const text = formatForContext();
					if (text) {
						onAddContext?.(text);
						open = false;
					}
				}}
			>
				<Copy class="h-4 w-4 mr-1" />
				Add to Chat
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
