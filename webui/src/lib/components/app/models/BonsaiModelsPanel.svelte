<script lang="ts">
	import { onMount } from 'svelte';
	import { BonsaiModelsService, type BonsaiModelDefinition, type BonsaiMissingFile, type BonsaiDownloadProgress } from '$lib/services/bonsai-models.service';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Check, Download, Loader2, Image as ImageIcon, Mic, Volume2, MessageSquare } from '@lucide/svelte';

	type Status = 'idle' | 'loading' | 'downloading' | 'done' | 'error';

	let models: BonsaiModelDefinition[] = [];
	let missingByModel: Record<string, BonsaiMissingFile[]> = {};
	let status: Status = 'idle';
	let error = '';
	let activeDownloads: Record<string, BonsaiDownloadProgress[]> = {};
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	$: chatModels = models.filter((m) => m.kind === 'chat');
	$: imageModels = models.filter((m) => m.kind === 'image');
	$: ttsModels = models.filter((m) => m.kind === 'tts');
	$: sttModels = models.filter((m) => m.kind === 'stt');

	onMount(async () => {
		await refresh();
	});

	async function refresh() {
		status = 'loading';
		try {
			models = await BonsaiModelsService.listModels();
			const missing = await BonsaiModelsService.listMissingFiles();
			missingByModel = {};
			for (const file of missing) {
				(missingByModel[file.modelId] ||= []).push(file);
			}
			status = 'idle';
		} catch (e) {
			error = String(e);
			status = 'error';
		}
	}

	function isModelComplete(modelId: string): boolean {
		return !(missingByModel[modelId]?.length > 0);
	}

	async function downloadModel(modelId: string) {
		status = 'downloading';
		try {
			await BonsaiModelsService.downloadModel(modelId);
			// Poll progress until complete
			if (pollTimer) clearInterval(pollTimer);
			pollTimer = setInterval(async () => {
				try {
					const progress = await BonsaiModelsService.getDownloadProgress(modelId);
					activeDownloads[modelId] = progress;
					activeDownloads = { ...activeDownloads };
					const allDone = progress.every((p) => p.status === 'done' || p.status === 'error');
					if (allDone) {
						if (pollTimer) clearInterval(pollTimer);
						pollTimer = null;
						await refresh();
						status = 'done';
					}
				} catch { /* ignore poll errors */ }
			}, 1000);
		} catch (e) {
			error = String(e);
			status = 'error';
		}
	}

	async function downloadAll() {
		status = 'downloading';
		try {
			await BonsaiModelsService.downloadModel();
			await refresh();
			status = 'done';
		} catch (e) {
			error = String(e);
			status = 'error';
		}
	}

	function kindIcon(kind: string) {
		if (kind === 'chat') return MessageSquare;
		if (kind === 'image') return ImageIcon;
		if (kind === 'tts') return Volume2;
		if (kind === 'stt') return Mic;
		return MessageSquare;
	}

	function formatBytes(bytes: number): string {
		if (!bytes) return '—';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
		if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
		return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-lg font-semibold">Bonsai Models</h2>
			<p class="text-sm text-muted-foreground mt-1">
				Download the prerequisite Bonsai ternary, image, TTS, and STT models. Mirrors the
				bonsai-beach model catalog.
			</p>
		</div>
		<Button onclick={downloadAll} disabled={status === 'downloading' || status === 'loading'}>
			{#if status === 'downloading'}
				<Loader2 class="h-4 w-4 animate-spin" />
			{:else}
				<Download class="h-4 w-4" />
			{/if}
			Download all missing
		</Button>
	</div>

	{#if error}
		<div class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
			{error}
		</div>
	{/if}

	{#if status === 'loading'}
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader2 class="h-4 w-4 animate-spin" />
			Loading bonsai model catalog…
		</div>
	{/if}

	{#each models as model (model.id)}
		{@const Icon = kindIcon(model.kind)}
		{@const complete = isModelComplete(model.id)}
		{@const missing = missingByModel[model.id] || []}
		<div class="rounded-lg border p-4">
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 rounded-md bg-muted p-2">
						<Icon class="h-5 w-5" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<h3 class="font-medium">{model.displayName}</h3>
							{#if complete}
								<Badge variant="default" class="gap-1"><Check class="h-3 w-3" /> Installed</Badge>
							{:else}
								<Badge variant="secondary">{missing.length} file{missing.length === 1 ? '' : 's'} missing</Badge>
							{/if}
						</div>
						{#if model.description}
							<p class="text-sm text-muted-foreground mt-1">{model.description}</p>
						{/if}
						<div class="mt-2 text-xs text-muted-foreground">
							<span class="font-mono">{model.id}</span>
							{#if model.size} · {model.size}{/if}
							{#if model.quant} · {model.quant}{/if}
							· port {model.port}
						</div>
						{#if missing.length > 0}
							<ul class="mt-2 space-y-1 text-xs text-muted-foreground">
								{#each missing as file}
									<li class="font-mono">{file.filename}</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>
				{#if !complete}
					<Button size="sm" onclick={() => downloadModel(model.id)} disabled={status === 'downloading'}>
						<Download class="h-4 w-4" />
						Download
					</Button>
				{/if}
			</div>

			{#if activeDownloads[model.id]?.length > 0}
				<div class="mt-3 space-y-2">
					{#each activeDownloads[model.id] as dl}
						<div class="space-y-1">
							<div class="flex justify-between text-xs">
								<span class="font-mono">{dl.id.split('/').pop()}</span>
								<span>{formatBytes(dl.current)} / {formatBytes(dl.total)} ({dl.status})</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full bg-primary transition-all" style="width: {Math.min(100, dl.progress * 100)}%"></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>
