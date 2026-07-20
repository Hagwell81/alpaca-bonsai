<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { ImageService, type ImageGenerateParams } from '$lib/services/image.service';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import {
		Image as ImageIcon,
		Loader2,
		Download,
		FolderOpen,
		Sparkles,
		AlertCircle
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type GenStatus = 'idle' | 'checking' | 'downloading' | 'generating' | 'done' | 'error';

	let status = $state<GenStatus>('idle');
	let error = $state('');
	let serviceReady = $state(false);
	let missingFiles = $state<string[]>([]);
	let downloadProgress = $state<string>('');

	// Generation params
	let prompt = $state('');
	let negativePrompt = $state('');
	let width = $state(512);
	let height = $state(512);
	let steps = $state(6);
	let cfgScale = $state(1.0);
	let samplingMethod = $state('dpm++2s_a');
	let seed = $state<number | ''>('');
	let useSeed = $state(false);

	// Gallery
	type GeneratedImage = { id: string; b64: string; prompt: string; timestamp: number; params: ImageGenerateParams };
	let gallery = $state<GeneratedImage[]>([]);

	// Example prompts from the Bonsai-Image-Demo project
	const examplePrompts: string[] = [
		'a tiny bonsai tree in a ceramic pot',
		'a red fox curled in a snowy forest',
		'an astronaut riding a horse on the moon',
		'a cyberpunk city street at night with neon lights',
		'a watercolor painting of a sailboat at sunset',
		'a portrait of a wise old wizard with a long beard',
		'a futuristic robot fixing a vintage radio',
		'a peaceful zen garden with cherry blossoms',
		'an underwater coral reef teeming with fish',
		'a steampunk airship over Victorian London'
	];

	function useExamplePrompt(p: string) {
		prompt = p;
	}

	const samplingMethods = [
		'euler_a', 'euler', 'dpm++2s_a', 'dpm++2m', 'dpm++3m_sde',
		'dpm++2m_sde', 'ddim', 'lms', 'heun', 'dpm_fast'
	];

	onMount(async () => {
		await checkReady();
	});

	async function checkReady() {
		status = 'checking';
		error = '';
		try {
			const s = await ImageService.getStatus();
			if (!s) {
				// Not in Electron — show a friendly message
				status = 'idle';
				return;
			}
			if (!s.ready) {
				const result = await ImageService.ensureReady();
				if (!result.ready) {
					missingFiles = result.missing || [];
					// Auto-download missing model files via bonsai:download-model IPC
					const api = (window as any).llamaAPI;
					if (api?.bonsaiDownloadModel && api?.bonsaiListMissingFiles) {
						const missing = await api.bonsaiListMissingFiles('bonsai-image-4b');
						if (missing && missing.length > 0) {
							status = 'downloading';
							downloadProgress = `Downloading ${missing.length} model file(s)...`;
							const dlResult = await api.bonsaiDownloadModel('bonsai-image-4b');
							if (dlResult?.success) {
								downloadProgress = '';
								// Re-check readiness after download
								const reCheck = await ImageService.ensureReady();
								if (reCheck.ready) {
									serviceReady = true;
									status = 'idle';
									toast.success('Image model downloaded and ready');
									return;
								} else {
									missingFiles = reCheck.missing || [];
									error = `Still missing: ${missingFiles.join(', ')}. Try Settings → Models → Bonsai Models.`;
									status = 'error';
									return;
								}
							} else if (dlResult?.errors?.length > 0) {
								downloadProgress = '';
								error = `Download failed: ${dlResult.errors.map((e: any) => e.filename).join(', ')}`;
								status = 'error';
								toast.error('Failed to download image model');
								return;
							}
						}
					}
					error = `Image service needs: ${missingFiles.join(', ')}. Download them from Settings → Models → Bonsai Models.`;
					status = 'error';
					return;
				}
			}
			serviceReady = true;
			status = 'idle';
		} catch (e) {
			error = String(e);
			status = 'error';
		}
	}

	async function generate() {
		if (!prompt.trim()) {
			toast.error('Please enter a prompt');
			return;
		}
		status = 'generating';
		error = '';
		try {
			const params: ImageGenerateParams = {
				prompt: prompt.trim(),
				negativePrompt: negativePrompt.trim() || undefined,
				width,
				height,
				steps,
				cfgScale,
				samplingMethod,
				seed: useSeed && seed !== '' ? Number(seed) : undefined,
				b64: true
			};
			const result = await ImageService.generate(params);
			if (result.success && result.b64) {
				const img: GeneratedImage = {
					id: crypto.randomUUID(),
					b64: result.b64,
					prompt: prompt.trim(),
					timestamp: Date.now(),
					params
				};
				gallery = [img, ...gallery];
				status = 'done';
				toast.success('Image generated');
			} else {
				error = result.error || 'Generation failed';
				status = 'error';
				toast.error(error);
			}
		} catch (e) {
			error = String(e);
			status = 'error';
			toast.error(error);
		}
	}

	function downloadImage(img: GeneratedImage) {
		const link = document.createElement('a');
		link.href = `data:image/png;base64,${img.b64}`;
		link.download = `bonsai-image-${img.id.slice(0, 8)}.png`;
		link.click();
	}

	async function openImageFolder() {
		await ImageService.openImageFolder();
	}

	function randomSeed() {
		seed = Math.floor(Math.random() * 2147483647);
		useSeed = true;
	}
</script>

<svelte:head>
	<title>Image Generation - Alpaca</title>
</svelte:head>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="border-b px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="rounded-lg bg-muted p-2">
					<ImageIcon class="h-6 w-6" />
				</div>
				<div>
					<h1 class="text-xl font-semibold">Image Generation</h1>
					<p class="text-sm text-muted-foreground">
						Local image generation with Bonsai Image 4B via sd.cpp
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				{#if status === 'downloading'}
					<Badge variant="secondary" class="gap-1">
						<Loader2 class="h-3 w-3 animate-spin" /> Downloading model...
					</Badge>
				{:else if serviceReady}
					<Badge variant="default" class="gap-1">
						<Sparkles class="h-3 w-3" /> Ready
					</Badge>
				{:else}
					<Badge variant="secondary">Not ready</Badge>
				{/if}
				<Button variant="outline" size="sm" onclick={openImageFolder}>
					<FolderOpen class="h-4 w-4" />
					Open folder
				</Button>
			</div>
		</div>
	</div>

	<div class="flex flex-1 gap-6 overflow-hidden p-6">
		<!-- Controls panel -->
		<div class="w-80 shrink-0 space-y-4 overflow-y-auto">
			<Card.Root>
				<Card.Content class="space-y-4 pt-6">
					<div class="space-y-2">
						<Label for="prompt">Prompt</Label>
						<textarea
							id="prompt"
							bind:value={prompt}
							placeholder="A serene mountain landscape at sunset..."
							class="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						></textarea>
						<div class="flex flex-wrap gap-1.5">
							{#each examplePrompts as p}
								<button
									type="button"
									class="rounded-full border border-input bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
									onclick={() => useExamplePrompt(p)}
									title={p}
								>
									{p.length > 32 ? p.slice(0, 30) + '…' : p}
								</button>
							{/each}
						</div>
					</div>

					<div class="space-y-2">
						<Label for="negative">Negative prompt</Label>
						<Input id="negative" bind:value={negativePrompt} placeholder="blurry, low quality..." />
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-2">
							<Label for="width">Width</Label>
							<Input id="width" type="number" bind:value={width} min={64} max={2048} step={64} />
						</div>
						<div class="space-y-2">
							<Label for="height">Height</Label>
							<Input id="height" type="number" bind:value={height} min={64} max={2048} step={64} />
						</div>
					</div>

					<div class="space-y-2">
						<Label for="steps">Steps: {steps}</Label>
						<input
							id="steps"
							type="range"
							bind:value={steps}
							min={1}
							max={30}
							step={1}
							class="w-full"
						/>
					</div>

					<div class="space-y-2">
						<Label for="cfg">CFG Scale: {cfgScale.toFixed(1)}</Label>
						<input
							id="cfg"
							type="range"
							bind:value={cfgScale}
							min={0}
							max={20}
							step={0.5}
							class="w-full"
						/>
					</div>

					<div class="space-y-2">
						<Label for="sampling">Sampling method</Label>
						<select
							id="sampling"
							bind:value={samplingMethod}
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{#each samplingMethods as method}
								<option value={method}>{method}</option>
							{/each}
						</select>
					</div>

					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<Label for="seed">Seed</Label>
							<div class="flex items-center gap-2">
								<input id="useSeed" type="checkbox" bind:checked={useSeed} class="h-4 w-4" />
								<label for="useSeed" class="text-xs text-muted-foreground">Use seed</label>
							</div>
						</div>
						<div class="flex gap-2">
							<Input
								type="number"
								bind:value={seed}
								disabled={!useSeed}
								placeholder="Random"
							/>
							<Button variant="outline" size="sm" onclick={randomSeed} disabled={!useSeed}>
								🎲
							</Button>
						</div>
					</div>

					<Button class="w-full" onclick={generate} disabled={status === 'generating' || !prompt.trim()}>
						{#if status === 'generating'}
							<Loader2 class="h-4 w-4 animate-spin" />
						{:else}
							<Sparkles class="h-4 w-4" />
						{/if}
						Generate
					</Button>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Gallery -->
		<div class="flex-1 overflow-y-auto">
			{#if status === 'downloading' && downloadProgress}
				<div class="mb-4 flex items-start gap-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
					<Loader2 class="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
					<div>{downloadProgress}</div>
				</div>
			{/if}
			{#if error}
				<div class="mb-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
					<div>{error}</div>
				</div>
			{/if}

			{#if gallery.length === 0}
				<div class="flex h-full flex-col items-center justify-center text-muted-foreground">
					<ImageIcon class="mb-4 h-16 w-16 opacity-30" />
					<p class="text-lg font-medium">No images yet</p>
					<p class="text-sm">Enter a prompt and click Generate to create images locally.</p>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
					{#each gallery as img (img.id)}
						<Card.Root class="overflow-hidden">
							<div class="relative aspect-square bg-muted">
								<img src={`data:image/png;base64,${img.b64}`} alt={img.prompt} class="h-full w-full object-cover" />
								<button
									class="absolute top-2 right-2 rounded-md bg-background/80 p-1.5 backdrop-blur hover:bg-background"
									onclick={() => downloadImage(img)}
									title="Download"
								>
									<Download class="h-4 w-4" />
								</button>
							</div>
							<Card.Content class="p-3">
								<p class="line-clamp-2 text-xs text-muted-foreground">{img.prompt}</p>
								<p class="mt-1 text-xs text-muted-foreground">
									{img.params.width}×{img.params.height} · {img.params.steps} steps · {img.params.samplingMethod}
								</p>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
