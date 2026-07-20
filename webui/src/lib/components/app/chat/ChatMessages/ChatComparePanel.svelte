<script lang="ts">
	import { config } from '$lib/stores/settings.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import { MessageRole } from '$lib/enums';
	import { findMessageById } from '$lib/utils';

	interface Props {
		allMessages: DatabaseMessage[];
		activeMessages: DatabaseMessage[];
	}

	let { allMessages, activeMessages }: Props = $props();

	const currentConfig = $derived(config());
	const isMultiModelEnabled = $derived(
		currentConfig.multiModelEnabled && isRouterMode()
	);
	const isComparisonMode = $derived(currentConfig.multiModelMode === 'comparison');

	/**
	 * Get the latest user message that has multiple assistant children.
	 */
	let lastUserMessageWithBranches = $derived.by(() => {
		if (!isMultiModelEnabled || !allMessages.length) return null;

		// Find the last user message in the active path
		for (let i = activeMessages.length - 1; i >= 0; i--) {
			const msg = activeMessages[i];
			if (msg.role === MessageRole.USER) {
				// Check if this user message has multiple assistant children
				const userMsgInAll = findMessageById(allMessages, msg.id);
				if (userMsgInAll && userMsgInAll.children.length > 1) {
					// Get all assistant children
					const assistantChildren = userMsgInAll.children
						.map((childId: string) => findMessageById(allMessages, childId))
						.filter((m: DatabaseMessage | undefined): m is DatabaseMessage =>
							m !== undefined && m.role === MessageRole.ASSISTANT
						);
					if (assistantChildren.length > 1) {
						return { userMessage: msg, branches: assistantChildren };
					}
				}
			}
		}
		return null;
	});

	function getModelLabel(msg: DatabaseMessage): string {
		if (msg.model) {
			const segments = msg.model.split(/\\|\//);
			const name = segments.pop() || msg.model;
			return name;
		}
		return 'Model';
	}

	function getBranchContent(msg: DatabaseMessage): string {
		if (msg.content) return msg.content;
		// Check background streaming state
		const convId = msg.convId;
		const stateKey = `${convId}:${msg.id}`;
		const bgState = chatStore.getBackgroundStreamingState(stateKey);
		return bgState?.response || '';
	}
</script>

{#if lastUserMessageWithBranches && isComparisonMode}
	<div class="mx-auto w-full max-w-[48rem]">
		<div class="mb-2 text-sm font-medium text-muted-foreground">
			Model Comparison ({lastUserMessageWithBranches.branches.length} responses)
		</div>
		<div
			class="grid gap-4"
			style="grid-template-columns: repeat({Math.min(lastUserMessageWithBranches.branches.length, 3)}, 1fr);"
		>
			{#each lastUserMessageWithBranches.branches as branch (branch.id)}
				<div class="rounded-xl border bg-card p-4 shadow-sm">
					<div class="mb-2 flex items-center gap-2">
						<span class="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
							{getModelLabel(branch)}
						</span>
					</div>
					<div class="prose prose-sm dark:prose-invert max-w-none">
						{#if getBranchContent(branch)}
							<p class="whitespace-pre-wrap text-sm">{getBranchContent(branch)}</p>
						{:else}
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
								Generating...
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
