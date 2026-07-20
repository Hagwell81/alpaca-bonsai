<script lang="ts">
	/**
	 * Integrations tab for the settings panel.
	 *
	 * Lists all available integrations with install status indicators and
	 * Launch buttons. When Launch is pressed:
	 *   - If the tool is installed: configures it to use the Alpaca API and
	 *     launches it in a new terminal window with the env vars preset.
	 *   - If the tool is not installed: shows a message stating the
	 *     integration is unavailable as not installed, with a link to the
	 *     install URL.
	 */
	import { onMount } from 'svelte';
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
		Terminal,
		CheckCircle2,
		XCircle,
		Loader2,
		RefreshCw,
		AlertCircle
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { launchStore } from '$lib/stores/launch.svelte';
	import { selectedModelName } from '$lib/stores/models.svelte';
	import type { LaunchIntegration } from '$lib/types';

	let activeCategory = $state<string>('');
	let copiedField = $state<string | null>(null);

	onMount(() => {
		launchStore.loadIntegrations();
		launchStore.checkAllInstalled();
	});

	const categories = $derived(Object.keys(launchStore.groupedIntegrations).sort());

	// Set the first category as active once integrations load
	$effect(() => {
		if (!activeCategory && categories.length > 0) {
			activeCategory = categories[0];
		}
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

	async function handleLaunch(integrationId: string) {
		const model = selectedModelName() || undefined;
		await launchStore.launchIntegration(integrationId, model);
	}

	async function handleRefreshStatus() {
		await launchStore.checkAllInstalled();
	}

	async function handleConfigure(integrationId: string) {
		const model = selectedModelName() || undefined;
		await launchStore.configureIntegration(integrationId, model);
	}

	async function handleGenerateEnv(integrationId: string) {
		const model = selectedModelName() || undefined;
		await launchStore.generateEnvFile(integrationId, model);
	}

	const currentModel = $derived(selectedModelName());
	const visibleIntegrations = $derived(
		activeCategory ? (launchStore.groupedIntegrations[activeCategory] || []) : []
	);
</script>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h4 class="text-sm font-semibold flex items-center gap-2">
				<Rocket class="h-4 w-4" />
				External Tool Integrations
			</h4>
			<p class="text-xs text-muted-foreground mt-1">
				Configure and launch external tools to use your local Alpaca API.
			</p>
		</div>
		<Button
			variant="ghost"
			size="sm"
			onclick={handleRefreshStatus}
			disabled={launchStore.isCheckingInstalled}
		>
			{#if launchStore.isCheckingInstalled}
				<Loader2 class="h-4 w-4 animate-spin" />
			{:else}
				<RefreshCw class="h-4 w-4" />
			{/if}
			Refresh
		</Button>
	</div>

	<!-- Active model banner -->
	{#if currentModel}
		<div class="rounded-md bg-muted p-2 text-xs flex items-center justify-between">
			<span>Active model: <span class="font-mono font-medium">{currentModel}</span></span>
			<span class="text-muted-foreground">Used for launched integrations</span>
		</div>
	{:else}
		<div class="rounded-md bg-amber-50 dark:bg-amber-950 p-2 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
			<AlertCircle class="h-3 w-3" />
			No model loaded. Load a model in the chat first.
		</div>
	{/if}

	<!-- Category tabs -->
	{#if categories.length > 0}
		<div class="flex flex-wrap gap-1 border-b pb-2">
			{#each categories as category}
				{@const Icon = getCategoryIcon(category)}
				<button
					class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors {activeCategory === category ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted'}"
					onclick={() => (activeCategory = category)}
				>
					<Icon class="h-3 w-3" />
					{category}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Integration cards -->
	<div class="space-y-2">
		{#if launchStore.isLoading && launchStore.integrations.length === 0}
			<div class="flex items-center justify-center py-8 text-muted-foreground text-sm">
				<Loader2 class="h-4 w-4 animate-spin mr-2" />
				Loading integrations...
			</div>
		{:else if launchStore.error}
			<div class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
				{launchStore.error}
			</div>
		{:else if visibleIntegrations.length === 0}
			<div class="text-center py-8 text-muted-foreground text-sm">
				No integrations in this category.
			</div>
		{:else}
			{#each visibleIntegrations as integration (integration.id)}
				{@const status = launchStore.getInstallStatus(integration.id)}
				{@const isLaunching = launchStore.isLaunching(integration.id)}
				<div class="rounded-lg border p-3 space-y-2">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<h5 class="font-medium text-sm truncate">{integration.name}</h5>
								{#if status}
									{#if status.installed}
										<Badge variant="default" class="text-[10px] gap-1 py-0 px-1.5">
											<CheckCircle2 class="h-2.5 w-2.5" />
											Installed
										</Badge>
									{:else}
										<Badge variant="secondary" class="text-[10px] gap-1 py-0 px-1.5">
											<XCircle class="h-2.5 w-2.5" />
											Not installed
										</Badge>
									{/if}
								{:else if launchStore.isCheckingInstalled}
									<Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
								{/if}
							</div>
							<p class="text-xs text-muted-foreground mt-0.5">
								{integration.category} — {integration.provider} provider
							</p>
							{#if status && !status.installed && status.detail}
								<p class="text-xs text-muted-foreground mt-1 italic">{status.detail}</p>
							{/if}
						</div>
						<a
							href={integration.installUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
						>
							Install <ExternalLink class="h-3 w-3" />
						</a>
					</div>

					<div class="flex flex-wrap gap-1.5">
						<Button
							size="sm"
							class="h-7 text-xs"
							onclick={() => handleLaunch(integration.id)}
							disabled={isLaunching || !currentModel}
							title={!currentModel ? 'Load a model first' : (status && !status.installed ? 'Check install status' : 'Launch with Alpaca configuration')}
						>
							{#if isLaunching}
								<Loader2 class="h-3 w-3 animate-spin mr-1" />
								Launching...
							{:else}
								<Terminal class="h-3 w-3 mr-1" />
								Launch
							{/if}
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-7 text-xs"
							onclick={() => handleConfigure(integration.id)}
							disabled={launchStore.isLoading}
						>
							<Code class="h-3 w-3 mr-1" />
							Configure
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-7 text-xs"
							onclick={() => handleGenerateEnv(integration.id)}
							disabled={launchStore.isGeneratingEnv}
						>
							<Download class="h-3 w-3 mr-1" />
							.env
						</Button>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Launch result panel -->
	{#if launchStore.lastLaunchResult}
		<div class="rounded-md border bg-muted/30 p-3 space-y-2">
			<div class="flex items-center justify-between">
				<h5 class="text-xs font-semibold flex items-center gap-1.5">
					{#if launchStore.lastLaunchResult.success}
						<CheckCircle2 class="h-3.5 w-3.5 text-green-500" />
						Launch Result
					{:else}
						<XCircle class="h-3.5 w-3.5 text-destructive" />
						Launch Failed
					{/if}
				</h5>
				<button
					class="text-xs text-muted-foreground hover:text-foreground"
					onclick={() => (launchStore.lastLaunchResult = null)}
				>
					Close
				</button>
			</div>

			{#if launchStore.lastLaunchResult.message}
				<p class="text-xs text-muted-foreground">{launchStore.lastLaunchResult.message}</p>
			{/if}

			{#if launchStore.lastLaunchResult.error}
				<p class="text-xs text-destructive">{launchStore.lastLaunchResult.error}</p>
			{/if}

			{#if launchStore.lastLaunchResult.installDetail}
				<p class="text-xs text-muted-foreground italic">{launchStore.lastLaunchResult.installDetail}</p>
			{/if}

			{#if launchStore.lastLaunchResult.manualCommand}
				<div class="space-y-1">
					<div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Launch Command</div>
					<div class="flex items-center gap-2 rounded-md bg-background border p-2 font-mono text-[11px]">
						<code class="flex-1 break-all">{launchStore.lastLaunchResult.manualCommand}</code>
						<button
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => launchStore.lastLaunchResult && handleCopy(launchStore.lastLaunchResult.manualCommand!, 'launchCommand')}
						>
							{#if copiedField === 'launchCommand'}
								<Check class="h-3 w-3 text-green-500" />
							{:else}
								<Copy class="h-3 w-3" />
							{/if}
						</button>
					</div>
				</div>
			{/if}

			{#if launchStore.lastLaunchResult.env && Object.keys(launchStore.lastLaunchResult.env).length > 0}
				<div class="space-y-1">
					<div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Environment Variables</div>
					<div class="rounded-md bg-background border p-2 font-mono text-[11px] space-y-0.5">
						{#each Object.entries(launchStore.lastLaunchResult.env) as [key, value]}
							<div class="flex items-center gap-2">
								<code class="flex-1 break-all">{key}={value}</code>
								<button
									class="shrink-0 text-muted-foreground hover:text-foreground"
									onclick={() => handleCopy(`${key}=${value}`, key)}
								>
									{#if copiedField === key}
										<Check class="h-2.5 w-2.5 text-green-500" />
									{:else}
										<Copy class="h-2.5 w-2.5" />
									{/if}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if launchStore.lastLaunchResult.instructions}
				<div class="text-xs text-muted-foreground border-t pt-2">
					<div class="text-[10px] font-medium uppercase tracking-wide mb-1">Instructions</div>
					<p class="whitespace-pre-line">{launchStore.lastLaunchResult.instructions}</p>
				</div>
			{/if}

			{#if launchStore.lastLaunchResult.configTip}
				<div class="rounded-md bg-amber-50 dark:bg-amber-950 p-2 text-xs text-amber-800 dark:text-amber-200">
					{launchStore.lastLaunchResult.configTip}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Configure result panel (existing flow) -->
	{#if launchStore.lastResult}
		<div class="rounded-md border bg-muted/30 p-3 space-y-2">
			<div class="flex items-center justify-between">
				<h5 class="text-xs font-semibold">
					{launchStore.selectedIntegration?.name} Configuration
				</h5>
				<button
					class="text-xs text-muted-foreground hover:text-foreground"
					onclick={() => (launchStore.lastResult = null)}
				>
					Close
				</button>
			</div>

			<p class="text-xs text-muted-foreground">{launchStore.lastResult.instructions}</p>

			{#if launchStore.lastResult.manualCommand}
				<div class="space-y-1">
					<div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Quick Launch Command</div>
					<div class="flex items-center gap-2 rounded-md bg-background border p-2 font-mono text-[11px]">
						<code class="flex-1 truncate">{launchStore.lastResult.manualCommand}</code>
						<button
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => launchStore.lastResult && handleCopy(launchStore.lastResult.manualCommand!, 'manualCommand')}
						>
							{#if copiedField === 'manualCommand'}
								<Check class="h-3 w-3 text-green-500" />
							{:else}
								<Copy class="h-3 w-3" />
							{/if}
						</button>
					</div>
				</div>
			{/if}

			{#if launchStore.lastResult.env && Object.keys(launchStore.lastResult.env).length > 0}
				<div class="space-y-1">
					<div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Environment Variables</div>
					<div class="rounded-md bg-background border p-2 font-mono text-[11px] space-y-0.5">
						{#each Object.entries(launchStore.lastResult.env) as [key, value]}
							<div class="flex items-center gap-2">
								<code class="flex-1 break-all">{key}={value}</code>
								<button
									class="shrink-0 text-muted-foreground hover:text-foreground"
									onclick={() => handleCopy(`${key}=${value}`, key)}
								>
									{#if copiedField === key}
										<Check class="h-2.5 w-2.5 text-green-500" />
									{:else}
										<Copy class="h-2.5 w-2.5" />
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
