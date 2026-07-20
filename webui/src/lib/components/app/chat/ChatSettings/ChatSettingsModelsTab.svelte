<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Box,
		Search,
		Download,
		Trash2,
		ExternalLink,
		ChevronDown,
		ChevronUp,
		Loader2,
		Eye,
		Upload
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { serverStore } from '$lib/stores/server.svelte';
	import { BonsaiModelsPanel } from '$lib/components/app/models';
	import {
		DesktopService,
		isElectron,
		type InstalledModel,
		type HuggingFaceSearchResult,
		type DownloadProgress
	} from '$lib/services/desktop.service';

	let electron = $state(false);
	let modelName = $derived(modelsStore.singleModelName ?? 'Unknown');
	let modelPath = $derived(serverStore.props?.model_path ?? null);
	let serverRole = $derived(serverStore.role ?? 'unknown');

	// Search state
	let searchQuery = $state('');
	let hfToken = $state('');
	let showTokenInput = $state(false);
	let searchLoading = $state(false);
	let searchResults: HuggingFaceSearchResult | null = $state(null);
	let searchError = $state('');

	// Installed models
	let installedModels = $state<InstalledModel[]>([]);
	let installedLoading = $state(false);

	// Downloads
	let activeDownloads = $state<
		Map<string, { filename: string; progress: number; status: string }>
	>(new Map());
	let downloadPollInterval: ReturnType<typeof setInterval> | null = $state(null);

	$effect(() => {
		electron = isElectron();
		if (electron) {
			loadInstalledModels();
		}
	});

	// Poll for llamaAPI availability in case preload loads after component mount.
	// Also handles the standalone-webui case: DesktopService works over HTTP,
	// so we load installed models regardless of Electron availability as long
	// as the desktop backend (API gateway) is reachable.
	$effect(() => {
		if (electron) return;
		const interval = setInterval(() => {
			if (isElectron()) {
				electron = true;
				clearInterval(interval);
			}
		}, 500);
		// Attempt to load installed models via HTTP — if the desktop backend
		// is running (even without Electron), this will succeed.
		loadInstalledModels();
		return () => clearInterval(interval);
	});

	$effect(() => {
		return () => {
			if (downloadPollInterval) clearInterval(downloadPollInterval);
		};
	});

	// Register download-complete listener and resume any in-progress downloads on mount
	$effect(() => {
		if (!electron) return;
		const unsub = DesktopService.onDownloadComplete((data: any) => {
			if (data?.success) {
				loadInstalledModels();
				modelsStore.fetch(true).catch(() => {});
			}
		});
		return () => unsub?.();
	});

	onMount(() => {
		if (!electron) return;
		DesktopService.getAllDownloadProgress().then((downloads: DownloadProgress[]) => {
			if (!downloads || downloads.length === 0) return;
			for (const dl of downloads) {
				const dlId = (dl as any).downloadId || '';
				if (dlId && !activeDownloads.has(dlId)) {
					activeDownloads.set(dlId, {
						filename: dlId.split('/').pop() || dlId,
						progress: Math.round((dl.progress ?? 0) * 100),
						status: dl.status
					});
				}
			}
			activeDownloads = new Map(activeDownloads);
			startDownloadPolling();
		}).catch((e: any) => {
			console.error('Failed to resume download polling:', e);
		});
	});

	async function loadInstalledModels() {
		installedLoading = true;
		try {
			installedModels = await DesktopService.getInstalledModels();
		} catch (e) {
			// Silent failure — the desktop backend may not be running in
			// standalone webui mode. The UI shows "no models installed".
			console.error('Failed to load installed models:', e);
		} finally {
			installedLoading = false;
		}
	}

	async function searchHuggingFace() {
		const query = searchQuery.trim();
		if (!query) return;
		searchLoading = true;
		searchError = '';
		searchResults = null;
		try {
			const result = await DesktopService.searchHuggingFace(query, hfToken.trim() || undefined);
			if (result.error) {
				searchError = result.error;
			} else {
				searchResults = result;
			}
		} catch (e: any) {
			searchError = e?.message || 'Search failed. Please try again.';
		} finally {
			searchLoading = false;
		}
	}

	async function downloadModel(repoId: string, filename: string, autoMmproj: boolean = false) {
		try {
			const result = await DesktopService.downloadHuggingFaceModel(
				repoId,
				filename,
				hfToken.trim() || undefined
			);
			const downloadId = result?.downloadId;
			if (downloadId) {
				activeDownloads.set(downloadId, {
					filename,
					progress: 0,
					status: 'starting'
				});
				activeDownloads = new Map(activeDownloads);
				startDownloadPolling();
			}
		} catch (e: any) {
			console.error('Failed to start download:', e);
		}
	}

	async function downloadModelWithMmproj(repoId: string, filename: string) {
		// Download the main model file
		await downloadModel(repoId, filename);

		// Auto-download mmproj files if this is a vision model repo
		if (searchResults?.hasVisionSupport && searchResults?.mmprojFiles?.length > 0) {
			for (const mmprojFile of searchResults.mmprojFiles) {
				// Check if already downloading or installed
				const dlId = getDownloadId(repoId, mmprojFile.filename);
				if (!activeDownloads.has(dlId)) {
					await downloadModel(repoId, mmprojFile.filename);
				}
			}
		}
	}

	function startDownloadPolling() {
		if (downloadPollInterval) return;
		downloadPollInterval = setInterval(async () => {
			const pendingIds = Array.from(activeDownloads.keys()).filter(
				(id) =>
					activeDownloads.get(id)?.status !== 'completed' &&
					activeDownloads.get(id)?.status !== 'error'
			);
			if (pendingIds.length === 0) {
				clearInterval(downloadPollInterval!);
				downloadPollInterval = null;
				return;
			}
			for (const id of pendingIds) {
				try {
					const progress = await DesktopService.getDownloadProgress(id);
					const current = activeDownloads.get(id);
					if (current) {
						activeDownloads.set(id, {
							...current,
							progress: Math.round((progress?.progress ?? 0) * 100),
							status: progress?.status ?? 'downloading'
						});
						if (
							progress?.status === 'completed' ||
							progress?.status === 'error'
						) {
							loadInstalledModels();
						}
					}
				} catch (e) {
					console.error('Download poll error:', e);
				}
			}
			activeDownloads = new Map(activeDownloads);
		}, 1000);
	}

	async function deleteInstalledModel(filename: string) {
		if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
		try {
			await DesktopService.deleteModel(filename);
			await loadInstalledModels();
		} catch (e: any) {
			alert('Failed to delete model: ' + (e?.message || 'Unknown error'));
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') searchHuggingFace();
	}

	function getDownloadId(repoId: string, filename: string) {
		const cleanRepoId = repoId
			.replace(/^https?:\/\/huggingface\.co\//, '')
			.replace(/\/$/, '')
			.trim();
		return `${cleanRepoId}/${filename}`;
	}

	// Import a local GGUF file via the Electron file picker. Only available
	// inside the desktop app — the standalone webui uses HuggingFace search
	// instead (no native file picker in a browser).
	async function importLocalModel() {
		const api = (window as any).llamaAPI;
		if (!api?.importLocalModel) return;
		try {
			await api.importLocalModel();
			await loadInstalledModels();
		} catch (e: any) {
			alert('Failed to import model: ' + (e?.message || 'Unknown error'));
		}
	}

	async function importVisionModel() {
		const api = (window as any).llamaAPI;
		if (!api?.importVisionModel) return;
		try {
			await api.importVisionModel();
			await loadInstalledModels();
		} catch (e: any) {
			alert('Failed to import vision model: ' + (e?.message || 'Unknown error'));
		}
	}
</script>

<div class="space-y-6">
	{#if electron}
		<BonsaiModelsPanel />
	{/if}
	<div class="space-y-4">
		<div class="grid">
			<h4 class="mb-2 text-sm font-medium">Current Model</h4>

			<div class="rounded-lg border border-border/50 bg-muted/30 p-4">
				<div class="flex items-center gap-3">
					<Box class="h-5 w-5 text-muted-foreground" />
					<div>
						<p class="text-sm font-medium">{modelName}</p>
						{#if modelPath}
							<p class="mt-1 text-xs text-muted-foreground break-all">{modelPath}</p>
						{/if}
						<p class="mt-1 text-xs text-muted-foreground">Server mode: {serverRole}</p>
					</div>
				</div>
			</div>
		</div>

		{#if modelsStore.models.length > 0}
			<div class="grid border-t border-border/30 pt-4">
				<h4 class="mb-2 text-sm font-medium">
					Available Server Models ({modelsStore.models.length})
				</h4>
				<div class="space-y-2">
					{#each modelsStore.models as model (model.id)}
						<div
							class="flex items-center justify-between rounded-md border border-border/30 px-3 py-2"
						>
							<div class="text-sm">{model.name ?? model.id}</div>
							{#if model.id === modelsStore.selectedModelId}
								<span class="text-xs text-muted-foreground">Selected</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if electron}
			<div class="grid border-t border-border/30 pt-4">
				<h4 class="mb-2 text-sm font-medium">Installed Models</h4>

				{#if installedLoading}
					<p class="text-sm text-muted-foreground">Loading...</p>
				{:else if installedModels.length === 0}
					<p class="text-sm text-muted-foreground">No GGUF models installed yet.</p>
				{:else}
					<div class="space-y-2">
						{#each installedModels as model (model.filename)}
							<div
								class="flex items-center justify-between rounded-md border border-border/30 px-3 py-2"
							>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<p class="truncate text-sm">{model.filename}</p>
										{#if model.hasMmproj}
											<Badge variant="secondary" class="h-4 gap-0.5 px-1.5 py-0 text-[10px]">
												<Eye class="h-2.5 w-2.5" />
												Vision
											</Badge>
										{/if}
									</div>
									<p class="text-xs text-muted-foreground">{model.sizeFormatted}</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-destructive"
									onclick={() => deleteInstalledModel(model.filename)}
									title="Delete model"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						{/each}
					</div>
				{/if}

				<div class="flex gap-2 pt-2">
					<Button variant="outline" size="sm" class="flex-1 gap-1" onclick={importLocalModel}>
						<Upload class="h-3.5 w-3.5" />
						<span class="text-xs">Import Local Model</span>
					</Button>
					<Button variant="outline" size="sm" class="flex-1 gap-1" onclick={importVisionModel}>
						<Eye class="h-3.5 w-3.5" />
						<span class="text-xs">Import Vision Model</span>
					</Button>
				</div>
			</div>

			<div class="grid border-t border-border/30 pt-4">
				<h4 class="mb-2 text-sm font-medium">HuggingFace Model Search</h4>

				<div class="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-xs text-amber-600 leading-relaxed">
					<strong>Download times vary by model size and internet speed.</strong><br>
					Large models (&gt;10 GB): 30-60+ minutes.<br>
					Medium models (5-10 GB): 10-30+ minutes.<br>
					Small models (&lt;5 GB): 5-10+ minutes.<br>
					<em>Please keep this settings dialog open until the download completes.</em>
				</div>

				<div class="space-y-3">
					<div class="flex gap-2">
						<Input
							bind:value={searchQuery}
							onkeydown={handleKeydown}
							placeholder="e.g. TheBloke/Llama-2-7B-GGUF"
							class="flex-1"
						/>
						<Button
							onclick={searchHuggingFace}
							disabled={searchLoading || !searchQuery.trim()}
						>
							{#if searchLoading}
								<Loader2 class="h-4 w-4 animate-spin" />
							{:else}
								<Search class="h-4 w-4" />
							{/if}
						</Button>
					</div>

					<button
						class="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
						onclick={() => (showTokenInput = !showTokenInput)}
					>
						{#if showTokenInput}
							<ChevronUp class="h-3 w-3" />
						{:else}
							<ChevronDown class="h-3 w-3" />
						{/if}
						HuggingFace Token (optional)
					</button>

					{#if showTokenInput}
						<Input
							bind:value={hfToken}
							type="password"
							placeholder="hf_xxxxxxxxxxxxxxxx"
							class="text-sm"
						/>
					{/if}

					{#if searchError}
						<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
							{searchError}
						</div>
					{/if}

					{#if searchResults}
						<Card.Root class="overflow-hidden">
							<Card.Header class="pb-3">
								<div class="flex items-start justify-between gap-2">
									<div>
										<Card.Title class="text-base">
											{searchResults.modelId || searchResults.repoId}
										</Card.Title>
										<Card.Description class="mt-1 text-xs">
											By {searchResults.author || 'unknown'} &middot; {searchResults.downloads?.toLocaleString() ?? 0}
											downloads
										</Card.Description>
									</div>
									<a
										href={`https://huggingface.co/${searchResults.repoId}`}
										target="_blank"
										rel="noopener noreferrer"
										class="text-muted-foreground hover:text-foreground"
									>
										<ExternalLink class="h-4 w-4" />
									</a>
								</div>
								{#if searchResults.tags.length > 0}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each searchResults.tags.slice(0, 6) as tag}
											<Badge variant="secondary" class="h-4 px-1.5 py-0 text-[10px]">
												{tag}
											</Badge>
											{/each}
									</div>
								{/if}
								{#if searchResults.hasVisionSupport}
									<Badge variant="outline" class="mt-2 h-5 gap-1 px-2 py-0 text-[11px] text-amber-500">
										<Eye class="h-3 w-3" />
										Vision Model
									</Badge>
								{/if}
							</Card.Header>
							<Card.Content class="space-y-2 pt-0">
								{#if searchResults.modelFiles.length > 0}
									<p class="mb-1 text-xs font-medium text-muted-foreground">Model Files</p>
									{#each searchResults.modelFiles as file (file.filename)}
										{@const dlId = getDownloadId(searchResults.repoId, file.filename)}
										<div
											class="flex items-center justify-between rounded-md border border-border/30 px-3 py-2"
										>
											<div class="min-w-0">
												<p class="truncate text-sm">{file.filename}</p>
												<p class="text-xs text-muted-foreground">
													{file.sizeFormatted || 'Unknown size'}
												</p>
											</div>
											{#if activeDownloads.has(dlId)}
												{@const dl = activeDownloads.get(dlId)}
												<div class="flex min-w-[100px] items-center gap-2">
													<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
														<div
															class="h-full rounded-full bg-primary transition-all"
															style="width: {dl?.progress ?? 0}%"
														></div>
													</div>
													<span class="w-8 text-right text-xs text-muted-foreground">
														{dl?.progress ?? 0}%
													</span>
												</div>
											{:else}
												<Button
													variant="outline"
													size="sm"
													class="h-7 gap-1"
													onclick={() =>
														downloadModelWithMmproj(searchResults!.repoId, file.filename)}
												>
													<Download class="h-3.5 w-3.5" />
													<span class="text-xs">Download</span>
												</Button>
											{/if}
										</div>
									{/each}
								{/if}

								{#if searchResults.mmprojFiles.length > 0}
									<p class="mb-1 mt-3 text-xs font-medium text-muted-foreground">
										Vision Projector (mmproj) Files
									</p>
									{#each searchResults.mmprojFiles as file (file.filename)}
										{@const dlId = getDownloadId(searchResults.repoId, file.filename)}
										<div
											class="flex items-center justify-between rounded-md border border-border/30 px-3 py-2"
										>
											<div class="min-w-0">
												<p class="truncate text-sm">{file.filename}</p>
												<p class="text-xs text-muted-foreground">
													{file.sizeFormatted || 'Unknown size'}
												</p>
											</div>
											{#if activeDownloads.has(dlId)}
												{@const dl = activeDownloads.get(dlId)}
												<div class="flex min-w-[100px] items-center gap-2">
													<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
														<div
															class="h-full rounded-full bg-primary transition-all"
															style="width: {dl?.progress ?? 0}%"
														></div>
													</div>
													<span class="w-8 text-right text-xs text-muted-foreground">
														{dl?.progress ?? 0}%
													</span>
												</div>
											{:else}
												<Button
													variant="outline"
													size="sm"
													class="h-7 gap-1"
													onclick={() =>
														downloadModel(searchResults!.repoId, file.filename)}
												>
													<Download class="h-3.5 w-3.5" />
													<span class="text-xs">Download</span>
												</Button>
											{/if}
										</div>
									{/each}
								{/if}

								{#if !searchResults.modelFiles.length && !searchResults.mmprojFiles.length}
									<p class="text-sm text-muted-foreground">
										No GGUF files found in this repository.
									</p>
								{/if}
							</Card.Content>
						</Card.Root>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
