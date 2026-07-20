<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
	import { providersStore } from '$lib/stores/providers.svelte';
	import { userStore } from '$lib/stores/user.svelte';
	import { toast } from 'svelte-sonner';
	import {
		KeyRound,
		Plus,
		Trash2,
		Edit3,
		Globe,
		Server,
		AlertCircle,
		Lock,
		Save,
		X,
		Cpu,
		Download,
		RefreshCw,
		CheckCircle2,
		CircleAlert,
		Loader2,
		Image as ImageIcon,
		GitBranch,
		Beaker,
		Zap,
		Terminal
	} from '@lucide/svelte';

	// Local backend (llama.cpp) state
	let backendInfo = $state<{ tag: string | null; backend: string | null; installed: boolean } | null>(null);
	let latestTag = $state<string | null>(null);
	let isCheckingUpdate = $state(false);
	let isUpdating = $state(false);
	let updateMessage = $state<string | null>(null);
	let updateError = $state<string | null>(null);

	// Progress tracking for backend update
	let updateProgress = $state<{ phase: string; progress: number; message: string } | null>(null);

	// Repo preference (bonsai variant vs upstream llama.cpp)
	let repoPreference = $state<'bonsai' | 'upstream'>('bonsai');
	let isSwitchingRepo = $state(false);

	// Per-repo release check state
	type RepoReleaseInfo = {
		tag: string | null;
		currentTag: string | null;
		installed: boolean;
		checking: boolean;
		updating: boolean;
		message: string | null;
		error: string | null;
	};

	const BONSAI_REPO = 'PrismML-Eng/llama.cpp';
	const UPSTREAM_REPO = 'ggml-org/llama.cpp';

	let bonsaiRelease = $state<RepoReleaseInfo>({ tag: null, currentTag: null, installed: false, checking: false, updating: false, message: null, error: null });
	let upstreamRelease = $state<RepoReleaseInfo>({ tag: null, currentTag: null, installed: false, checking: false, updating: false, message: null, error: null });
	let sdRelease = $state<RepoReleaseInfo>({ tag: null, currentTag: null, installed: false, checking: false, updating: false, message: null, error: null });

	// Experimental Bonsai features (4-bit KV cache, speculative decoding)
	let bonsaiExperimental = $state<{ kv4: boolean; speculative: boolean }>({ kv4: false, speculative: false });
	let dsparkAvailable = $state<boolean>(false);
	let dsparkFilename = $state<string | null>(null);
	let isSavingExperimental = $state(false);

	// TUI (Terminal UI) state
	let tuiWorkspace = $state<string | null>(null);
	let tuiMainWorkspace = $state<string | null>(null);
	let tuiBinaryFound = $state<boolean>(false);
	let tuiBinaryPath = $state<string | null>(null);
	let isLaunchingTui = $state(false);
	let tuiMessage = $state<string | null>(null);
	let tuiError = $state<string | null>(null);

	async function loadBackendInfo() {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.getCurrentBackendInfo) return;
			const info = await api.getCurrentBackendInfo();
			backendInfo = info;
			// Also load repo preference
			if (api.getRepoPreference) {
				const pref = await api.getRepoPreference();
				if (pref?.preference) repoPreference = pref.preference;
			}
			// Also load sd.cpp info
			if (api.getSdBackendInfo) {
				const sdInfo = await api.getSdBackendInfo();
				sdRelease.currentTag = sdInfo.tag;
				sdRelease.installed = sdInfo.installed;
			}
			// Load experimental bonsai feature toggles
			if (api.getBonsaiExperimental) {
				const exp = await api.getBonsaiExperimental();
				if (exp) bonsaiExperimental = { kv4: !!exp.kv4, speculative: !!exp.speculative };
			}
			// Check if dspark drafter is available
			if (api.checkDsparkDrafter) {
				const dspark = await api.checkDsparkDrafter();
				if (dspark?.success) {
					dsparkAvailable = dspark.available;
					dsparkFilename = dspark.filename;
				}
			}
			// Load TUI state
			await loadTuiState();
		} catch (e) {
			console.error('Failed to load backend info:', e);
		}
	}

	async function toggleExperimentalFeature(key: 'kv4' | 'speculative', enabled: boolean) {
		isSavingExperimental = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.setBonsaiExperimental) {
				toast.error('Experimental feature toggle not available');
				return;
			}
			const newOpts = { ...bonsaiExperimental, [key]: enabled };
			const result = await api.setBonsaiExperimental(newOpts);
			if (result?.success) {
				bonsaiExperimental = result.options;
				const label = key === 'kv4' ? '4-bit KV cache' : 'Speculative decoding';
				toast.success(
					enabled
						? label + ' enabled. Restart the backend to apply.'
						: label + ' disabled. Restart the backend to apply.'
				);
			} else {
				toast.error(result?.error || 'Failed to toggle experimental feature');
			}
		} catch (e) {
			toast.error('Failed to toggle experimental feature');
		} finally {
			isSavingExperimental = false;
		}
	}

	// ── TUI (Terminal UI) functions ──────────────────────────────────
	async function loadTuiState() {
		try {
			const api = (window as any).llamaAPI;
			if (!api) return;
			if (api.tuiGetWorkspace) {
				const result = await api.tuiGetWorkspace();
				if (result?.success) {
					tuiWorkspace = result.tuiWorkspace;
					tuiMainWorkspace = result.mainWorkspace;
				}
			}
			if (api.tuiFindBinary) {
				const binResult = await api.tuiFindBinary();
				if (binResult?.success) {
					tuiBinaryFound = binResult.found;
					tuiBinaryPath = binResult.binaryPath;
				}
			}
		} catch (e) {
			console.error('Failed to load TUI state:', e);
		}
	}

	async function selectTuiWorkspaceFolder() {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.selectLocalFolder) {
				toast.error('Folder picker not available');
				return;
			}
			const result = await api.selectLocalFolder();
			if (result.canceled) return;
			const folderPath = result.folderPath;
			if (api.tuiSetWorkspace) {
				const setResult = await api.tuiSetWorkspace(folderPath);
				if (setResult?.success) {
					tuiWorkspace = setResult.tuiWorkspace;
					toast.success('TUI workspace folder set');
				}
			}
		} catch (e) {
			toast.error('Failed to select folder');
		}
	}

	async function useMainWorkspaceForTui() {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.tuiSetWorkspace) return;
			if (!tuiMainWorkspace) {
				toast.error('No main workspace folder configured');
				return;
			}
			const result = await api.tuiSetWorkspace(tuiMainWorkspace);
			if (result?.success) {
				tuiWorkspace = result.tuiWorkspace;
				toast.success('Using main workspace folder for TUI');
			}
		} catch (e) {
			toast.error('Failed to set workspace');
		}
	}

	async function clearTuiWorkspace() {
		try {
			const api = (window as any).llamaAPI;
			if (!api?.tuiSetWorkspace) return;
			const result = await api.tuiSetWorkspace(null);
			if (result?.success) {
				tuiWorkspace = null;
				toast.success('TUI workspace cleared');
			}
		} catch (e) {
			toast.error('Failed to clear workspace');
		}
	}

	async function launchTui() {
		isLaunchingTui = true;
		tuiMessage = null;
		tuiError = null;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.tuiLaunch) {
				toast.error('TUI launch not available');
				return;
			}
			const result = await api.tuiLaunch({});
			if (result?.success) {
				tuiMessage = 'Terminal UI launched in a new window.';
				toast.success('Terminal UI launched');
			} else {
				tuiError = result?.error || 'Failed to launch TUI';
				toast.error(tuiError ?? 'Failed to launch TUI');
			}
		} catch (e) {
			tuiError = 'Failed to launch TUI';
			toast.error(tuiError ?? 'Failed to launch TUI');
		} finally {
			isLaunchingTui = false;
		}
	}

	async function checkForBackendUpdate() {
		isCheckingUpdate = true;
		updateMessage = null;
		updateError = null;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.checkForBackendUpdate) {
				updateError = 'Backend update check not available';
				return;
			}
			const [info, release] = await Promise.all([
				api.getCurrentBackendInfo?.() || Promise.resolve(null),
				api.checkForBackendUpdate()
			]);
			if (info) backendInfo = info;
			if (release.success) {
				latestTag = release.tag;
				const currentNum = parseInt(String(backendInfo?.tag || '').replace(/\D/g, ''), 10) || 0;
				const latestNum = parseInt(String(release.tag).replace(/\D/g, ''), 10) || 0;
				if (backendInfo?.tag && latestNum <= currentNum) {
					updateMessage = `Backend is up to date (${backendInfo.tag}).`;
				} else {
					updateMessage = null;
				}
			} else {
				updateError = release.error || 'Failed to check for updates';
			}
		} catch (e) {
			updateError = 'Failed to check for updates';
		} finally {
			isCheckingUpdate = false;
		}
	}

	// Check release for a specific repo (bonsai variant or upstream)
	async function checkRepoRelease(repo: string, state: RepoReleaseInfo) {
		state.checking = true;
		state.error = null;
		state.message = null;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.checkReleaseForRepo) {
				state.error = 'Release check not available';
				return;
			}
			const result = await api.checkReleaseForRepo(repo);
			if (result.success) {
				state.tag = result.tag;
				state.message = `Latest: ${result.tag}`;
			} else {
				state.error = result.error || 'Failed to check release';
			}
		} catch (e) {
			state.error = 'Failed to check release';
		} finally {
			state.checking = false;
		}
	}

	// Check sd.cpp release
	async function checkSdCppRelease() {
		sdRelease.checking = true;
		sdRelease.error = null;
		sdRelease.message = null;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.checkSdCppUpdate) {
				sdRelease.error = 'sd.cpp update check not available';
				return;
			}
			const result = await api.checkSdCppUpdate();
			if (result.success) {
				sdRelease.tag = result.tag;
				sdRelease.currentTag = result.currentTag;
				sdRelease.installed = result.installed;
				sdRelease.message = result.installed
					? `Installed: ${result.currentTag} | Latest: ${result.tag}`
					: `Not installed | Latest: ${result.tag}`;
			} else {
				sdRelease.error = result.error || 'Failed to check sd.cpp release';
			}
		} catch (e) {
			sdRelease.error = 'Failed to check sd.cpp release';
		} finally {
			sdRelease.checking = false;
		}
	}

	// Switch repo preference
	async function switchRepoPreference(pref: 'bonsai' | 'upstream') {
		if (pref === repoPreference) return;
		isSwitchingRepo = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.setRepoPreference) {
				toast.error('Repo preference switch not available');
				return;
			}
			const result = await api.setRepoPreference(pref);
			if (result.success) {
				repoPreference = pref;
				toast.success(`Switched to ${pref === 'bonsai' ? 'Bonsai variant (PrismML-Eng)' : 'Upstream (ggml-org)'} llama.cpp. Restart the backend to use the new variant.`);
			} else {
				toast.error(result.error || 'Failed to switch repo preference');
			}
		} catch (e) {
			toast.error('Failed to switch repo preference');
		} finally {
			isSwitchingRepo = false;
		}
	}

	// Update sd.cpp backend
	async function updateSdBackend() {
		sdRelease.updating = true;
		sdRelease.error = null;
		sdRelease.message = null;
		updateProgress = { phase: 'starting', progress: 0, message: 'Starting sd.cpp update...' };

		const api = (window as any).llamaAPI;
		if (!api?.updateSdBackend) {
			sdRelease.error = 'sd.cpp update not available';
			sdRelease.updating = false;
			updateProgress = null;
			return;
		}

		if (api.onBackendUpdateProgress) {
			api.onBackendUpdateProgress(handleBackendUpdateProgress);
		}

		try {
			const result = await api.updateSdBackend();
			if (result.success) {
				sdRelease.message = result.message;
				if (result.latestTag) {
					sdRelease.currentTag = result.latestTag;
					sdRelease.installed = true;
				}
				toast.success(result.message);
			} else {
				sdRelease.error = result.error || 'sd.cpp update failed';
				toast.error(sdRelease.error ?? 'sd.cpp update failed');
			}
		} catch (e) {
			sdRelease.error = 'sd.cpp update failed';
			toast.error(sdRelease.error ?? 'sd.cpp update failed');
		} finally {
			sdRelease.updating = false;
			updateProgress = null;
			if (api.offBackendUpdateProgress) {
				api.offBackendUpdateProgress(handleBackendUpdateProgress);
			}
		}
	}

	function handleBackendUpdateProgress(data: any) {
		updateProgress = {
			phase: data.phase,
			progress: data.progress ?? 0,
			message: data.message ?? ''
		};

		if (data.phase === 'ready') {
			toast.success(data.message || 'Backend updated and server is ready!');
			updateProgress = null;
			loadBackendInfo();
		} else if (data.phase === 'error') {
			toast.error(data.message || 'Backend update failed');
			updateProgress = null;
		}
	}

	async function updateBackend() {
		isUpdating = true;
		updateMessage = null;
		updateError = null;
		updateProgress = { phase: 'starting', progress: 0, message: 'Starting update...' };

		const api = (window as any).llamaAPI;
		if (!api?.updateBackend) {
			updateError = 'Backend update not available';
			isUpdating = false;
			updateProgress = null;
			return;
		}

		// Register progress listener
		if (api.onBackendUpdateProgress) {
			api.onBackendUpdateProgress(handleBackendUpdateProgress);
		}

		try {
			const result = await api.updateBackend();
			if (result.success) {
				updateMessage = result.message;
				if (result.latestTag) latestTag = result.latestTag;
				if (result.latestTag) {
					backendInfo = {
						tag: result.latestTag,
						backend: backendInfo?.backend ?? null,
						installed: true
					};
				}
				if (result.updated) {
					toast.success(result.message);
				}
			} else {
				updateError = result.error || 'Update failed';
				toast.error(updateError ?? 'Update failed');
			}
		} catch (e) {
			updateError = 'Update failed';
			toast.error(updateError ?? 'Update failed');
		} finally {
			isUpdating = false;
			updateProgress = null;
			// Unregister progress listener
			if (api.offBackendUpdateProgress) {
				api.offBackendUpdateProgress(handleBackendUpdateProgress);
			}
		}
	}

	// Load backend info on mount
	$effect(() => {
		loadBackendInfo();
	});

	let isEditing = $state(false);
	let editId = $state('');
	let name = $state('');
	let baseUrl = $state('');
	let apiKey = $state('');
	let modelsText = $state('');
	let isSaving = $state(false);
	let deleteConfirmId = $state<string | null>(null);

	function startAdd() {
		isEditing = true;
		editId = crypto.randomUUID();
		name = '';
		baseUrl = '';
		apiKey = '';
		modelsText = '';
		deleteConfirmId = null;
	}

	function startEdit(provider: (typeof providersStore.providers)[0]) {
		isEditing = true;
		editId = provider.id;
		name = provider.name;
		baseUrl = provider.baseUrl;
		apiKey = provider.apiKey || '';
		modelsText = (provider.models || []).join(', ');
		deleteConfirmId = null;
	}

	function cancelEdit() {
		isEditing = false;
		editId = '';
		name = '';
		baseUrl = '';
		apiKey = '';
		modelsText = '';
		deleteConfirmId = null;
	}

	async function handleSave() {
		if (!name.trim() || !baseUrl.trim()) return;
		isSaving = true;
		const models = modelsText
			.split(',')
			.map((m) => m.trim())
			.filter(Boolean);
		const success = await providersStore.saveProvider(editId, name.trim(), baseUrl.trim(), apiKey, models);
		isSaving = false;
		if (success) {
			cancelEdit();
		}
	}

	async function handleDelete(id: string) {
		if (deleteConfirmId !== id) {
			deleteConfirmId = id;
			return;
		}
		await providersStore.deleteProvider(id);
		deleteConfirmId = null;
	}

	function cancelDelete() {
		deleteConfirmId = null;
	}
</script>

<div class="space-y-6">
	<!-- Local Backend (llama.cpp) — Active variant -->
	<Card>
		<CardHeader class="pb-3">
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-2">
					<Cpu class="h-4 w-4 text-muted-foreground" />
					<CardTitle class="text-base">Local Backend (llama.cpp)</CardTitle>
				</div>
				{#if backendInfo?.tag && latestTag}
					{@const currentNum = parseInt(String(backendInfo.tag).replace(/\D/g, ''), 10) || 0}
					{@const latestNum = parseInt(String(latestTag).replace(/\D/g, ''), 10) || 0}
					{#if latestNum > currentNum}
						<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
							<CircleAlert class="mr-1 h-3 w-3" />
							Update available
						</span>
					{:else}
						<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
							<CheckCircle2 class="mr-1 h-3 w-3" />
							Up to date
						</span>
					{/if}
				{/if}
			</div>
			<CardDescription>
				Active variant: <strong>{repoPreference === 'bonsai' ? 'Bonsai (PrismML-Eng)' : 'Upstream (ggml-org)'}</strong>
				&bull; Current version: {backendInfo?.tag ?? 'Not installed'}
				{#if latestTag && latestTag !== backendInfo?.tag}
					&nbsp;&bull; Latest: {latestTag}
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3 pt-0">
			<!-- Repo preference selector -->
			<div class="space-y-2">
				<div class="flex items-center gap-2 text-sm">
					<GitBranch class="h-4 w-4 text-muted-foreground" />
					<span class="font-medium">llama.cpp Variant</span>
				</div>
				<div class="flex gap-2">
					<Button
						variant={repoPreference === 'bonsai' ? 'default' : 'outline'}
						size="sm"
						onclick={() => switchRepoPreference('bonsai')}
						disabled={isSwitchingRepo}
					>
						Bonsai (PrismML-Eng)
					</Button>
					<Button
						variant={repoPreference === 'upstream' ? 'default' : 'outline'}
						size="sm"
						onclick={() => switchRepoPreference('upstream')}
						disabled={isSwitchingRepo}
					>
						Upstream (ggml-org)
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					The Bonsai variant includes ternary model patches. Switch to upstream once llama.cpp natively supports Bonsai models. The backend restarts with the new variant on next update.
				</p>
			</div>

			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={checkForBackendUpdate}
					disabled={isCheckingUpdate || isUpdating}
				>
					<RefreshCw class="mr-1 h-4 w-4 {isCheckingUpdate ? 'animate-spin' : ''}" />
					{isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
				</Button>
				{#if latestTag && backendInfo?.tag}
					{@const currentNum = parseInt(String(backendInfo.tag).replace(/\D/g, ''), 10) || 0}
					{@const latestNum = parseInt(String(latestTag).replace(/\D/g, ''), 10) || 0}
					{#if latestNum > currentNum}
						<Button
							variant="default"
							size="sm"
							onclick={updateBackend}
							disabled={isUpdating}
						>
							{#if isUpdating}
								<Loader2 class="mr-1 h-4 w-4 animate-spin" />
								Updating...
							{:else}
								<Download class="mr-1 h-4 w-4" />
								Update to {latestTag}
							{/if}
						</Button>
					{/if}
				{/if}
			</div>

			{#if updateProgress}
				<div class="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
					<div class="flex items-center justify-between">
						<span class="text-sm font-medium">{updateProgress.message}</span>
						{#if updateProgress.phase === 'downloading'}
							<span class="text-xs text-muted-foreground">{updateProgress.progress}%</span>
						{/if}
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-all duration-300"
							style="width: {updateProgress.progress}%"
						></div>
					</div>
				</div>
			{/if}

			{#if updateMessage}
				<div class="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
					{updateMessage}
				</div>
			{/if}
			{#if updateError}
				<div class="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300">
					{updateError}
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Per-repo release checks -->
	<div class="grid gap-4 md:grid-cols-2">
		<!-- Bonsai variant (PrismML-Eng/llama.cpp) -->
		<Card>
			<CardHeader class="pb-3">
				<div class="flex items-start justify-between">
					<div class="flex items-center gap-2">
						<GitBranch class="h-4 w-4 text-muted-foreground" />
						<CardTitle class="text-sm">Bonsai Variant</CardTitle>
					</div>
					{#if bonsaiRelease.tag && bonsaiRelease.currentTag !== bonsaiRelease.tag}
						<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
							Update available
						</span>
					{:else if bonsaiRelease.tag && bonsaiRelease.currentTag === bonsaiRelease.tag}
						<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
							Up to date
						</span>
					{/if}
				</div>
				<CardDescription class="text-xs">PrismML-Eng/llama.cpp — ternary model patches</CardDescription>
			</CardHeader>
			<CardContent class="space-y-2 pt-0">
				<div class="text-xs text-muted-foreground">
					{#if bonsaiRelease.currentTag}
						Installed: {bonsaiRelease.currentTag}
					{:else}
						Not installed
					{/if}
					{#if bonsaiRelease.tag}
						&bull; Latest: {bonsaiRelease.tag}
					{/if}
				</div>
				<div class="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						class="h-7 text-xs"
						onclick={() => checkRepoRelease(BONSAI_REPO, bonsaiRelease)}
						disabled={bonsaiRelease.checking}
					>
						<RefreshCw class="mr-1 h-3 w-3 {bonsaiRelease.checking ? 'animate-spin' : ''}" />
						{bonsaiRelease.checking ? 'Checking...' : 'Check'}
					</Button>
				</div>
				{#if bonsaiRelease.error}
					<div class="text-xs text-red-600 dark:text-red-400">{bonsaiRelease.error}</div>
				{/if}
				{#if bonsaiRelease.message}
					<div class="text-xs text-muted-foreground">{bonsaiRelease.message}</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Upstream (ggml-org/llama.cpp) -->
		<Card>
			<CardHeader class="pb-3">
				<div class="flex items-start justify-between">
					<div class="flex items-center gap-2">
						<GitBranch class="h-4 w-4 text-muted-foreground" />
						<CardTitle class="text-sm">Upstream llama.cpp</CardTitle>
					</div>
					{#if upstreamRelease.tag && upstreamRelease.currentTag !== upstreamRelease.tag}
						<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
							Update available
						</span>
					{:else if upstreamRelease.tag && upstreamRelease.currentTag === upstreamRelease.tag}
						<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
							Up to date
						</span>
					{/if}
				</div>
				<CardDescription class="text-xs">ggml-org/llama.cpp — official upstream</CardDescription>
			</CardHeader>
			<CardContent class="space-y-2 pt-0">
				<div class="text-xs text-muted-foreground">
					{#if upstreamRelease.currentTag}
						Installed: {upstreamRelease.currentTag}
					{:else}
						Not installed
					{/if}
					{#if upstreamRelease.tag}
						&bull; Latest: {upstreamRelease.tag}
					{/if}
				</div>
				<div class="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						class="h-7 text-xs"
						onclick={() => checkRepoRelease(UPSTREAM_REPO, upstreamRelease)}
						disabled={upstreamRelease.checking}
					>
						<RefreshCw class="mr-1 h-3 w-3 {upstreamRelease.checking ? 'animate-spin' : ''}" />
						{upstreamRelease.checking ? 'Checking...' : 'Check'}
					</Button>
				</div>
				{#if upstreamRelease.error}
					<div class="text-xs text-red-600 dark:text-red-400">{upstreamRelease.error}</div>
				{/if}
				{#if upstreamRelease.message}
					<div class="text-xs text-muted-foreground">{upstreamRelease.message}</div>
				{/if}
			</CardContent>
		</Card>
	</div>

	<!-- sd.cpp (stable-diffusion.cpp) -->
	<Card>
		<CardHeader class="pb-3">
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-2">
					<ImageIcon class="h-4 w-4 text-muted-foreground" />
					<CardTitle class="text-base">Image Backend (sd.cpp)</CardTitle>
				</div>
				{#if sdRelease.tag && sdRelease.currentTag && sdRelease.currentTag !== sdRelease.tag}
					<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
						<CircleAlert class="mr-1 h-3 w-3" />
						Update available
					</span>
					{:else if sdRelease.tag && sdRelease.currentTag === sdRelease.tag}
					<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
						<CheckCircle2 class="mr-1 h-3 w-3" />
						Up to date
					</span>
				{/if}
			</div>
			<CardDescription>
				leejet/stable-diffusion.cpp — used for Bonsai Image 4B generation
				{#if sdRelease.currentTag}
					&bull; Installed: {sdRelease.currentTag}
				{/if}
				{#if sdRelease.tag}
					&bull; Latest: {sdRelease.tag}
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3 pt-0">
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={checkSdCppRelease}
					disabled={sdRelease.checking || sdRelease.updating}
				>
					<RefreshCw class="mr-1 h-4 w-4 {sdRelease.checking ? 'animate-spin' : ''}" />
					{sdRelease.checking ? 'Checking...' : 'Check for Updates'}
				</Button>
				{#if sdRelease.tag && (!sdRelease.currentTag || sdRelease.currentTag !== sdRelease.tag)}
					<Button
						variant="default"
						size="sm"
						onclick={updateSdBackend}
						disabled={sdRelease.updating}
					>
						{#if sdRelease.updating}
							<Loader2 class="mr-1 h-4 w-4 animate-spin" />
							Updating...
						{:else}
							<Download class="mr-1 h-4 w-4" />
							{sdRelease.installed ? `Update to ${sdRelease.tag}` : `Install ${sdRelease.tag}`}
						{/if}
					</Button>
				{/if}
			</div>
			{#if sdRelease.error}
				<div class="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300">
					{sdRelease.error}
				</div>
			{/if}
			{#if sdRelease.message}
				<div class="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
					{sdRelease.message}
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Bonsai Experimental Features (27B only) -->
	<Card>
		<CardHeader class="pb-3">
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-2">
					<Beaker class="h-4 w-4 text-muted-foreground" />
					<CardTitle class="text-base">Bonsai Experimental Features</CardTitle>
				</div>
				<span class="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
					27B only
				</span>
			</div>
			<CardDescription>
				Opt-in performance features for Ternary Bonsai 27B. Requires backend restart to apply.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4 pt-0">
			<!-- 4-bit KV Cache -->
			<div class="space-y-2 rounded-lg border border-border/50 p-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Zap class="h-4 w-4 text-amber-500" />
						<span class="text-sm font-medium">4-bit KV Cache</span>
					</div>
					<button
						type="button"
						class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {bonsaiExperimental.kv4 ? 'bg-primary' : 'bg-muted'}"
						onclick={() => toggleExperimentalFeature('kv4', !bonsaiExperimental.kv4)}
						disabled={isSavingExperimental}
						aria-label="Toggle 4-bit KV cache"
					>
						<span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {bonsaiExperimental.kv4 ? 'translate-x-6' : 'translate-x-1'}"></span>
					</button>
				</div>
				<p class="text-xs text-muted-foreground">
					Stores the KV cache in Q4_0 (~3.5x smaller memory). Memory tool, not a speed tool — decode is slightly slower than F16.
					Only useful at very long contexts on tight machines. Requires flash attention (already enabled for Bonsai models).
					{#if bonsaiExperimental.kv4}
						<span class="block mt-1 text-amber-600 dark:text-amber-400">
							Active — will apply on next backend restart.
						</span>
					{/if}
				</p>
			</div>

			<!-- Speculative Decoding (dspark) -->
			<div class="space-y-2 rounded-lg border border-border/50 p-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Zap class="h-4 w-4 text-blue-500" />
						<span class="text-sm font-medium">Speculative Decoding (dspark)</span>
					</div>
					<button
						type="button"
						class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {bonsaiExperimental.speculative ? 'bg-primary' : 'bg-muted'}"
						onclick={() => toggleExperimentalFeature('speculative', !bonsaiExperimental.speculative)}
						disabled={isSavingExperimental}
						aria-label="Toggle speculative decoding"
					>
						<span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {bonsaiExperimental.speculative ? 'translate-x-6' : 'translate-x-1'}"></span>
					</button>
				</div>
				<p class="text-xs text-muted-foreground">
					Uses the paired dspark drafter for ~1.8-2x faster decode on CUDA (code/reasoning workloads).
					Trade-offs: disables cross-request prompt-cache reuse, forces single slot. CUDA only — not recommended on Metal/Vulkan/CPU.
				</p>
				{#if dsparkAvailable}
					<p class="text-xs text-emerald-600 dark:text-emerald-400">
						Drafter available: {dsparkFilename}
					</p>
				{:else}
					<p class="text-xs text-amber-600 dark:text-amber-400">
						Drafter not found — download the dspark drafter GGUF to enable this feature.
					</p>
				{/if}
				{#if bonsaiExperimental.speculative}
					<p class="text-xs text-amber-600 dark:text-amber-400">
						Active — will apply on next backend restart (if drafter is available).
					</p>
				{/if}
			</div>
		</CardContent>
	</Card>

	<!-- Terminal UI (TUI) -->
	<Card>
		<CardHeader class="pb-3">
			<div class="flex items-center gap-2">
				<Terminal class="h-4 w-4 text-muted-foreground" />
				<CardTitle class="text-base">Terminal UI</CardTitle>
			</div>
			<CardDescription>
				Launch the alpaca-tui terminal interface for model management and chat. Configure a workspace folder for file context.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4 pt-0">
			<!-- TUI binary status -->
			<div class="space-y-1">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">Binary Status</span>
					{#if tuiBinaryFound}
						<span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
							Found
						</span>
					{:else}
						<span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
							Not found
						</span>
					{/if}
				</div>
				{#if tuiBinaryFound && tuiBinaryPath}
					<p class="text-xs text-muted-foreground break-all">{tuiBinaryPath}</p>
				{:else}
					<p class="text-xs text-muted-foreground">
						Build the TUI with: <code class="rounded bg-muted px-1 py-0.5">cd tui && cargo build --release</code>
					</p>
				{/if}
			</div>

			<div class="border-t border-border/50 pt-3"></div>

			<!-- Workspace folder configuration -->
			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">TUI Workspace Folder</span>
				</div>
				<p class="text-xs text-muted-foreground">
					The workspace folder is passed to the TUI for file context. If not set, the TUI will show a workspace selection step on launch.
				</p>
				{#if tuiWorkspace}
					<div class="rounded-lg bg-muted/50 p-2 text-sm">
						<span class="text-muted-foreground">Current:</span>
						<span class="ml-1 break-all">{tuiWorkspace}</span>
					</div>
					<div class="flex gap-2">
						<Button size="sm" variant="outline" onclick={selectTuiWorkspaceFolder}>
							Change Folder
						</Button>
						{#if tuiMainWorkspace && tuiMainWorkspace !== tuiWorkspace}
							<Button size="sm" variant="outline" onclick={useMainWorkspaceForTui}>
								Use Main Workspace
							</Button>
						{/if}
						<Button size="sm" variant="ghost" onclick={clearTuiWorkspace}>
							Clear
						</Button>
					</div>
				{:else}
					<div class="flex gap-2">
						<Button size="sm" variant="outline" onclick={selectTuiWorkspaceFolder}>
							Select Folder
						</Button>
						{#if tuiMainWorkspace}
							<Button size="sm" variant="outline" onclick={useMainWorkspaceForTui}>
								Use Main Workspace
							</Button>
						{/if}
					</div>
					{#if tuiMainWorkspace}
						<p class="text-xs text-muted-foreground">
							Main workspace: {tuiMainWorkspace}
						</p>
					{/if}
				{/if}
			</div>

			<div class="border-t border-border/50 pt-3"></div>

			<!-- Launch button -->
			<div class="flex items-center gap-3">
				<Button
					size="sm"
					onclick={launchTui}
					disabled={!tuiBinaryFound || isLaunchingTui}
				>
					{isLaunchingTui ? 'Launching...' : 'Launch Terminal UI'}
				</Button>
				{#if tuiMessage}
					<span class="text-sm text-emerald-600 dark:text-emerald-400">{tuiMessage}</span>
				{/if}
				{#if tuiError}
					<span class="text-sm text-red-600 dark:text-red-400">{tuiError}</span>
				{/if}
			</div>
		</CardContent>
	</Card>

	{#if !userStore.isLoggedIn}
		<div class="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
			<div class="flex items-start gap-3">
				<AlertCircle class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
				<div class="space-y-1">
					<p class="text-sm font-medium text-amber-800 dark:text-amber-300">
						Authentication Required
					</p>
					<p class="text-sm text-amber-700 dark:text-amber-400">
						Provider credentials are stored securely per user account.
						Please log in or register to add and persist custom providers.
						Without an account, any entered details will not be saved.
					</p>
				</div>
			</div>
		</div>
	{/if}

	{#if providersStore.providers.length > 0}
		<div class="space-y-3">
			{#each providersStore.providers as provider (provider.id)}
				<Card>
					<CardHeader class="pb-3">
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-2">
								<Server class="h-4 w-4 text-muted-foreground" />
								<CardTitle class="text-base">{provider.name}</CardTitle>
							</div>
							<div class="flex gap-1">
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8"
									onclick={() => startEdit(provider)}
								>
									<Edit3 class="h-4 w-4" />
								</Button>
								{#if deleteConfirmId === provider.id}
									<Button
										variant="destructive"
										size="sm"
										class="h-8"
										onclick={() => handleDelete(provider.id)}
									>
										Confirm
									</Button>
									<Button
										variant="outline"
										size="sm"
										class="h-8"
										onclick={cancelDelete}
									>
										<X class="h-4 w-4" />
									</Button>
								{:else}
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8 text-destructive hover:text-destructive"
										onclick={() => handleDelete(provider.id)}
									>
										<Trash2 class="h-4 w-4" />
									</Button>
								{/if}
							</div>
						</div>
						<CardDescription class="flex items-center gap-1">
							<Globe class="h-3 w-3" />
							{provider.baseUrl}
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-2 pt-0">
						<div class="flex items-center gap-2 text-sm">
							<KeyRound class="h-4 w-4 text-muted-foreground" />
							<span class="text-muted-foreground">
								{#if provider.apiKey}
									<Lock class="inline h-3 w-3 text-emerald-500" />
									API key stored securely
								{:else}
									No API key configured
								{/if}
							</span>
						</div>
						{#if provider.models && provider.models.length > 0}
							<div class="flex flex-wrap gap-1 pt-1">
								{#each provider.models as model}
									<span class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										{model}
									</span>
								{/each}
							</div>
						{/if}
					</CardContent>
				</Card>
			{/each}
		</div>
	{:else if !isEditing}
		<div class="rounded-lg border border-dashed border-border p-6 text-center">
			<Server class="mx-auto h-8 w-8 text-muted-foreground" />
			<p class="mt-2 text-sm font-medium">No custom providers configured</p>
			<p class="text-xs text-muted-foreground">
				Add OpenAI-compatible providers to use them alongside local models.
			</p>
		</div>
	{/if}

	{#if isEditing}
		<Card>
			<CardHeader>
				<CardTitle class="text-base">
					{editId && providersStore.providers.some((p) => p.id === editId) ? 'Edit Provider' : 'Add Provider'}
				</CardTitle>
				<CardDescription>
					Configure an OpenAI-compatible API endpoint.
					{#if !userStore.isLoggedIn}
						<span class="text-amber-600 dark:text-amber-400">Not saved: log in to persist credentials.</span>
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="space-y-2">
					<Label for="provider-name">Provider Name</Label>
					<Input id="provider-name" bind:value={name} placeholder="e.g., My OpenAI Proxy" />
				</div>
				<div class="space-y-2">
					<Label for="provider-url">Base URL</Label>
					<Input
						id="provider-url"
						bind:value={baseUrl}
						placeholder="https://api.example.com/v1"
					/>
					<p class="text-xs text-muted-foreground">
						The base URL for the provider's OpenAI-compatible API.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="provider-key">API Key</Label>
					<Input
						id="provider-key"
						type="password"
						bind:value={apiKey}
						placeholder="sk-..."
					/>
					<p class="text-xs text-muted-foreground">
						Stored securely via OS keychain when you have an account.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="provider-models">Models (optional)</Label>
					<Input
						id="provider-models"
						bind:value={modelsText}
						placeholder="gpt-4, gpt-3.5-turbo"
					/>
					<p class="text-xs text-muted-foreground">
						Comma-separated list of available model IDs.
					</p>
				</div>
				<div class="flex gap-2 pt-2">
					<Button
						variant="default"
						onclick={handleSave}
						disabled={isSaving || !name.trim() || !baseUrl.trim()}
					>
						<Save class="mr-2 h-4 w-4" />
						{isSaving ? 'Saving...' : 'Save Provider'}
					</Button>
					<Button variant="outline" onclick={cancelEdit}>
						<X class="mr-2 h-4 w-4" />
						Cancel
					</Button>
				</div>
			</CardContent>
		</Card>
	{:else}
		<Button variant="outline" class="w-full" onclick={startAdd}>
			<Plus class="mr-2 h-4 w-4" />
			Add Custom Provider
		</Button>
	{/if}
</div>
