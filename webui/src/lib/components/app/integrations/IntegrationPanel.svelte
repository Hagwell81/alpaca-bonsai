<script lang="ts">
	import { launchStore } from '$lib/stores/launch.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { selectedModelName } from '$lib/stores/models.svelte';
	import {
		Rocket,
		Code,
		Bot,
		Monitor,
		Workflow,
		BookOpen,
		ExternalLink,
		Copy,
		Check,
		Download,
		FolderOpen,
		Terminal
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	let copiedField = $state<string | null>(null);
	let activeTab = $state<string>('Coding Agents');

	onMount(() => {
		launchStore.loadIntegrations();
	});

	function getCategoryIcon(category: string) {
		switch (category) {
			case 'Coding Agents': return Code;
			case 'Assistants': return Bot;
			case 'IDEs & Editors': return Monitor;
			case 'Automation': return Workflow;
			case 'Notebooks': return BookOpen;
			default: return Rocket;
		}
	}

	function handleCopy(text: string, field: string) {
		navigator.clipboard.writeText(text);
		copiedField = field;
		setTimeout(() => (copiedField = null), 2000);
	}

	async function handleConfigure(integrationId: string) {
		await launchStore.configureIntegration(integrationId, selectedModelName() || undefined);
	}

	async function handleGenerateEnv(integrationId: string) {
		await launchStore.generateEnvFile(integrationId, selectedModelName() || undefined);
	}

	const categories = $derived(Object.keys(launchStore.groupedIntegrations).sort());
	const currentModel = $derived(selectedModelName());
</script>

<div class="flex h-full flex-col">
	<div class="border-b px-4 py-3">
		<h2 class="text-lg font-semibold flex items-center gap-2">
			<Rocket class="h-5 w-5" />
			Integrations
		</h2>
		<p class="text-sm text-muted-foreground mt-1">
			Configure external tools to use your local Alpaca API.
		</p>
	</div>

	<div class="flex flex-1 overflow-hidden">
		<!-- Category sidebar -->
		<div class="w-48 border-r flex flex-col">
			<ScrollArea class="flex-1">
				<div class="p-2 space-y-1">
					{#each categories as category}
						{@const Icon = getCategoryIcon(category)}
						<button
							class="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors {activeTab === category ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted text-muted-foreground'}"
							onclick={() => (activeTab = category)}
						>
							<Icon class="h-4 w-4" />
							{category}
						</button>
					{/each}
				</div>
			</ScrollArea>
		</div>

		<!-- Main content -->
		<div class="flex-1 overflow-hidden flex flex-col">
			<ScrollArea class="flex-1 p-4">
				{#if launchStore.isLoading && launchStore.integrations.length === 0}
					<div class="flex items-center justify-center h-32 text-muted-foreground">
						Loading integrations...
					</div>
				{:else if launchStore.error}
					<div class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
						{launchStore.error}
					</div>
				{:else}
					<div class="space-y-4">
						{#if currentModel}
							<div class="rounded-md bg-muted p-3 text-sm flex items-center justify-between">
								<span>Active model: <span class="font-mono font-medium">{currentModel}</span></span>
								<span class="text-muted-foreground text-xs">This model will be used for integrations</span>
							</div>
						{:else}
							<div class="rounded-md bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-200">
								No model selected. Load a model in the chat to use with integrations.
							</div>
						{/if}

						{#each launchStore.groupedIntegrations[activeTab] || [] as integration}
							<div class="rounded-lg border p-4 space-y-3">
								<div class="flex items-start justify-between">
									<div>
										<h3 class="font-semibold">{integration.name}</h3>
										<p class="text-sm text-muted-foreground">{integration.category} — {integration.provider} provider</p>
									</div>
									<a
										href={integration.installUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
									>
										Install <ExternalLink class="h-3 w-3" />
									</a>
								</div>

								<div class="flex gap-2">
									<Button
										size="sm"
										onclick={() => handleConfigure(integration.id)}
										disabled={launchStore.isLoading}
									>
										<Terminal class="h-4 w-4 mr-1" />
										Configure
									</Button>
									<Button
										variant="outline"
										size="sm"
										onclick={() => handleGenerateEnv(integration.id)}
										disabled={launchStore.isGeneratingEnv}
									>
										<Download class="h-4 w-4 mr-1" />
										.env
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</ScrollArea>
		</div>
	</div>

	<!-- Result panel -->
	{#if launchStore.lastResult}
		<div class="border-t bg-muted/30 p-4 space-y-3 max-h-[40%] overflow-y-auto">
			<div class="flex items-center justify-between">
				<h3 class="font-semibold text-sm">
					{launchStore.selectedIntegration?.name} Configuration
				</h3>
				<button
					class="text-xs text-muted-foreground hover:text-foreground"
					onclick={() => (launchStore.lastResult = null)}
				>
					Close
				</button>
			</div>

			<p class="text-sm text-muted-foreground">{launchStore.lastResult.instructions}</p>

			{#if launchStore.lastResult.manualCommand}
				<div class="space-y-1">
					<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Launch Command</div>
					<div class="flex items-center gap-2 rounded-md bg-background border p-2 font-mono text-xs">
						<code class="flex-1 truncate">{launchStore.lastResult.manualCommand}</code>
						<button
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => launchStore.lastResult && handleCopy(launchStore.lastResult.manualCommand!, 'manualCommand')}
						>
							{#if copiedField === 'manualCommand'}
								<Check class="h-4 w-4 text-green-500" />
							{:else}
								<Copy class="h-4 w-4" />
							{/if}
						</button>
					</div>
				</div>
			{/if}

			{#if launchStore.lastResult.env && Object.keys(launchStore.lastResult.env).length > 0}
				<div class="space-y-1">
					<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Environment Variables</div>
					<div class="rounded-md bg-background border p-2 font-mono text-xs space-y-1">
						{#each Object.entries(launchStore.lastResult.env) as [key, value]}
							<div class="flex items-center gap-2">
								<code class="flex-1">{key}={value}</code>
								<button
									class="shrink-0 text-muted-foreground hover:text-foreground"
									onclick={() => handleCopy(`${key}=${value}`, key)}
								>
									{#if copiedField === key}
										<Check class="h-3 w-3 text-green-500" />
									{:else}
										<Copy class="h-3 w-3" />
									{/if}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if launchStore.lastResult.configTip}
				<div class="rounded-md bg-amber-50 dark:bg-amber-950 p-2 text-xs text-amber-800 dark:text-amber-200">
					{launchStore.lastResult.configTip}
				</div>
			{/if}
		</div>
	{/if}
</div>
