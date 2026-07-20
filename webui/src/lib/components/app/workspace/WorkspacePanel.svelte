<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { toast } from 'svelte-sonner';
	import {
		FolderOpen,
		Folder,
		FileText,
		Box,
		Loader2,
		ChevronRight,
		ChevronDown,
		RefreshCw
	} from '@lucide/svelte';
	import { workspaceStore, type WorkspaceFileTreeNode } from '$lib/stores/workspace.svelte';

	// Expand/collapse state for tree nodes
	let expandedNodes = $state<Set<string>>(new Set());

	function toggleNode(node: WorkspaceFileTreeNode) {
		if (!node.isDirectory) return;
		const next = new Set(expandedNodes);
		if (next.has(node.path)) {
			next.delete(node.path);
		} else {
			next.add(node.path);
		}
		expandedNodes = next;
	}

	function renderNode(node: WorkspaceFileTreeNode, depth = 0) {
		const isExpanded = expandedNodes.has(node.path);
		const paddingLeft = `${depth * 0.75 + 0.5}rem`;
		return { isExpanded, paddingLeft };
	}
</script>

<div class="flex h-full flex-col overflow-hidden border-l border-border/30 bg-background">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-border/30 px-4 py-3">
		<div class="flex items-center gap-2">
			<Folder class="h-4 w-4 text-muted-foreground" />
			<h2 class="text-sm font-semibold">Workspace</h2>
		</div>
		<Button variant="ghost" size="icon-sm" onclick={() => workspaceStore.loadState()} title="Refresh">
			<RefreshCw class="h-4 w-4 {workspaceStore.isLoading ? 'animate-spin' : ''}" />
		</Button>
	</div>

	<!-- Folder Info -->
	<div class="border-b border-border/30 px-4 py-3">
		{#if workspaceStore.folderPath}
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<div class="flex items-center gap-1.5">
						{#if workspaceStore.isSandbox}
							<Box class="h-3.5 w-3.5 text-primary" />
							<span class="text-[10px] font-medium text-primary">Sandbox</span>
						{:else}
							<Folder class="h-3.5 w-3.5 text-muted-foreground" />
							<span class="text-[10px] font-medium text-muted-foreground">Local</span>
						{/if}
					</div>
					<p class="mt-1 truncate text-xs text-muted-foreground" title={workspaceStore.folderPath}>
						{workspaceStore.folderPath}
					</p>
				</div>
			</div>
		{:else}
			<p class="text-xs text-muted-foreground">No workspace folder selected</p>
		{/if}

		<div class="mt-2 flex gap-2">
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1 text-xs"
				onclick={() => workspaceStore.selectLocalFolder()}
				disabled={workspaceStore.isLoading}
			>
				{#if workspaceStore.isLoading}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<FolderOpen class="h-3.5 w-3.5" />
				{/if}
				Select Folder
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1 text-xs"
				onclick={() => workspaceStore.openSandbox()}
				disabled={workspaceStore.isLoading}
			>
				{#if workspaceStore.isLoading}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<Box class="h-3.5 w-3.5" />
				{/if}
				Sandbox
			</Button>
		</div>
	</div>

	<!-- File Tree -->
	<ScrollArea class="flex-1">
		{#if workspaceStore.fileTree.length > 0}
			<div class="py-1">
				{#each workspaceStore.fileTree as node (node.path)}
					{@const { isExpanded, paddingLeft } = renderNode(node)}
					<button
						class="flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left text-xs transition-colors hover:bg-muted"
						style="padding-left: {paddingLeft}"
						onclick={() => toggleNode(node)}
					>
						{#if node.isDirectory}
							{#if isExpanded}
								<ChevronDown class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
							{:else}
								<ChevronRight class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
							{/if}
							<Folder class="h-3.5 w-3.5 flex-shrink-0 text-primary" />
						{:else}
							<span class="w-3 flex-shrink-0"></span>
							<FileText class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
						{/if}
						<span class="truncate">{node.name}</span>
					</button>
					{#if node.isDirectory && isExpanded && node.children}
						{#each node.children as child (child.path)}
							{@const childRender = renderNode(child, 1)}
							<button
								class="flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left text-xs transition-colors hover:bg-muted"
								style="padding-left: {childRender.paddingLeft}"
								onclick={() => toggleNode(child)}
							>
								{#if child.isDirectory}
									{#if childRender.isExpanded}
										<ChevronDown class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
									{:else}
										<ChevronRight class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
									{/if}
									<Folder class="h-3.5 w-3.5 flex-shrink-0 text-primary" />
								{:else}
									<span class="w-3 flex-shrink-0"></span>
									<FileText class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
								{/if}
								<span class="truncate">{child.name}</span>
							</button>
							{#if child.isDirectory && childRender.isExpanded && child.children}
								{#each child.children as grandchild (grandchild.path)}
									{@const gcRender = renderNode(grandchild, 2)}
									<button
										class="flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left text-xs transition-colors hover:bg-muted"
										style="padding-left: {gcRender.paddingLeft}"
										onclick={() => toggleNode(grandchild)}
									>
										{#if grandchild.isDirectory}
											{#if gcRender.isExpanded}
												<ChevronDown class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
											{:else}
												<ChevronRight class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
											{/if}
											<Folder class="h-3.5 w-3.5 flex-shrink-0 text-primary" />
										{:else}
											<span class="w-3 flex-shrink-0"></span>
											<FileText class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
										{/if}
										<span class="truncate">{grandchild.name}</span>
									</button>
								{/each}
							{/if}
						{/each}
					{/if}
				{/each}
			</div>
		{:else if workspaceStore.folderPath}
			<div class="px-4 py-8 text-center text-xs text-muted-foreground">Empty workspace</div>
		{:else}
			<div class="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
				<Folder class="mb-2 h-8 w-8 text-muted-foreground/50" />
				<p class="text-sm text-muted-foreground">Select a folder or open a sandbox to get started</p>
			</div>
		{/if}
	</ScrollArea>
</div>
