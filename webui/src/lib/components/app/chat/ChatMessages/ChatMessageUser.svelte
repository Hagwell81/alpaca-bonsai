<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import {
		ChatAttachmentsList,
		MarkdownContent,
		CollapsibleContentBlock
	} from '$lib/components/app';
	import { getMessageEditContext } from '$lib/contexts';
	import { config } from '$lib/stores/settings.svelte';
	import ChatMessageActions from './ChatMessageActions.svelte';
	import ChatMessageEditForm from './ChatMessageEditForm.svelte';
	import { MessageRole } from '$lib/enums';
	import { Globe, Search, Code as CodeIcon } from '@lucide/svelte';

	// Sentinel block injected by DialogWebSearch.formatForContext().
	// Recognised here so fetched web/code context renders as an expandable
	// card (matching the reasoning block UX) instead of a wall of text.
	type UserSegment =
		| { type: 'text'; content: string }
		| {
				type: 'web_context';
				kind: 'web-page' | 'web-search' | 'code' | string;
				title: string;
				url: string;
				body: string;
		  };

	const WEB_CONTEXT_RE = /<web_context\s+([^>]*?)>\n?([\s\S]*?)\n?<\/web_context>/g;

	function decodeAttr(v: string): string {
		return v
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&');
	}

	function readAttr(attrs: string, name: string): string {
		const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
		return m ? decodeAttr(m[1]) : '';
	}

	function parseUserContent(content: string): UserSegment[] {
		const segs: UserSegment[] = [];
		let last = 0;
		let m: RegExpExecArray | null;
		const re = new RegExp(WEB_CONTEXT_RE.source, 'g');
		while ((m = re.exec(content)) !== null) {
			if (m.index > last) {
				const text = content.slice(last, m.index).trim();
				if (text) segs.push({ type: 'text', content: text });
			}
			const attrs = m[1] || '';
			segs.push({
				type: 'web_context',
				kind: readAttr(attrs, 'kind') || 'web-page',
				title: readAttr(attrs, 'title'),
				url: readAttr(attrs, 'url'),
				body: m[2] || ''
			});
			last = m.index + m[0].length;
		}
		if (last < content.length) {
			const text = content.slice(last).trim();
			if (text) segs.push({ type: 'text', content: text });
		}
		return segs;
	}

	function iconFor(kind: string) {
		if (kind === 'code') return CodeIcon;
		if (kind === 'web-search') return Search;
		return Globe;
	}

	interface Props {
		class?: string;
		message: DatabaseMessage;
		siblingInfo?: ChatMessageSiblingInfo | null;
		deletionInfo: {
			totalCount: number;
			userMessages: number;
			assistantMessages: number;
			messageTypes: string[];
		} | null;
		showDeleteDialog: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onConfirmDelete: () => void;
		onForkConversation?: (options: { name: string; includeAttachments: boolean }) => void;
		onShowDeleteDialogChange: (show: boolean) => void;
		onNavigateToSibling?: (siblingId: string) => void;
		onCopy: () => void;
	}

	let {
		class: className = '',
		message,
		siblingInfo = null,
		deletionInfo,
		showDeleteDialog,
		onEdit,
		onDelete,
		onConfirmDelete,
		onForkConversation,
		onShowDeleteDialogChange,
		onNavigateToSibling,
		onCopy
	}: Props = $props();

	// Get contexts
	const editCtx = getMessageEditContext();

	let isMultiline = $state(false);
	let messageElement: HTMLElement | undefined = $state();
	const currentConfig = config();

	const segments = $derived(parseUserContent(message.content || ''));
	const hasWebContext = $derived(segments.some((s) => s.type === 'web_context'));

	$effect(() => {
		if (!messageElement || !message.content.trim()) return;

		if (message.content.includes('\n')) {
			isMultiline = true;
			return;
		}

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const element = entry.target as HTMLElement;
				const estimatedSingleLineHeight = 24; // Typical line height for text-md

				isMultiline = element.offsetHeight > estimatedSingleLineHeight * 1.5;
			}
		});

		resizeObserver.observe(messageElement);

		return () => {
			resizeObserver.disconnect();
		};
	});
</script>

<div
	aria-label="User message with actions"
	class="group flex flex-col items-end gap-3 md:gap-2 {className}"
	role="group"
>
	{#if editCtx.isEditing}
		<ChatMessageEditForm />
	{:else}
		{#if message.extra && message.extra.length > 0}
			<div class="mb-2 max-w-[80%]">
				<ChatAttachmentsList attachments={message.extra} readonly imageHeight="h-80" />
			</div>
		{/if}

		{#if hasWebContext}
			<!-- Mixed rendering: web_context blocks become collapsible cards
			     (matching the reasoning UX), surrounding text stays in the
			     normal user-message Card. -->
			<div class="flex w-full max-w-[80%] flex-col items-end gap-2">
				{#each segments as seg, i (i)}
					{#if seg.type === 'text'}
						<Card
							class="w-full overflow-y-auto rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-1.5 text-foreground backdrop-blur-md dark:bg-primary/15"
							style="max-height: var(--max-message-height); overflow-wrap: anywhere; word-break: break-word;"
						>
							{#if currentConfig.renderUserContentAsMarkdown}
								<div>
									<MarkdownContent class="markdown-user-content -my-4" content={seg.content} />
								</div>
							{:else}
								<span class="text-md whitespace-pre-wrap">{seg.content}</span>
							{/if}
						</Card>
					{:else}
						<CollapsibleContentBlock
							class="w-full"
							icon={iconFor(seg.kind)}
							title={seg.title || (seg.kind === 'code' ? 'Code context' : 'Web context')}
							subtitle={seg.url}
						>
							<div
								class="pt-3 text-xs leading-relaxed break-words whitespace-pre-wrap"
							>
								{seg.body}
							</div>
						</CollapsibleContentBlock>
					{/if}
				{/each}
			</div>
		{:else if message.content.trim()}
			<Card
				class="max-w-[80%] overflow-y-auto rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-1.5 text-foreground backdrop-blur-md data-[multiline]:py-2.5 dark:bg-primary/15"
				data-multiline={isMultiline ? '' : undefined}
				style="max-height: var(--max-message-height); overflow-wrap: anywhere; word-break: break-word;"
			>
				{#if currentConfig.renderUserContentAsMarkdown}
					<div bind:this={messageElement}>
						<MarkdownContent class="markdown-user-content -my-4" content={message.content} />
					</div>
				{:else}
					<span bind:this={messageElement} class="text-md whitespace-pre-wrap">
						{message.content}
					</span>
				{/if}
			</Card>
		{/if}

		{#if message.timestamp}
			<div class="max-w-[80%]">
				<ChatMessageActions
					actionsPosition="right"
					{deletionInfo}
					justify="end"
					{onConfirmDelete}
					{onCopy}
					{onDelete}
					{onEdit}
					{onForkConversation}
					{onNavigateToSibling}
					{onShowDeleteDialogChange}
					{siblingInfo}
					{showDeleteDialog}
					role={MessageRole.USER}
				/>
			</div>
		{/if}
	{/if}
</div>
