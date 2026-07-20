import { LaunchService } from '$lib/services/launch.service';
import type {
	LaunchConfigResult,
	LaunchIntegration,
	LaunchInstallStatus,
	LaunchIntegrationResult
} from '$lib/types';

class LaunchStore {
	integrations = $state<LaunchIntegration[]>([]);
	selectedIntegrationId = $state<string | null>(null);
	selectedModel = $state<string>('');
	lastResult = $state<LaunchConfigResult | null>(null);
	/** Map of integrationId -> install status. Populated by checkAllInstalled(). */
	installStatuses = $state<Record<string, LaunchInstallStatus>>({});
	/** Result of the most recent launchIntegration() call. */
	lastLaunchResult = $state<LaunchIntegrationResult | null>(null);
	/** Set of integration IDs currently being launched (in-progress). */
	launchingIds = $state<Set<string>>(new Set());
	isLoading = $state(false);
	isGeneratingEnv = $state(false);
	isCheckingInstalled = $state(false);
	error = $state<string | null>(null);

	async loadIntegrations() {
		this.isLoading = true;
		this.error = null;
		try {
			const response = await LaunchService.listIntegrations();
			if (response.success && response.integrations) {
				this.integrations = response.integrations;
			} else {
				this.error = response.error || 'Failed to load integrations';
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.isLoading = false;
		}
	}

	async configureIntegration(integrationId: string, model?: string) {
		this.isLoading = true;
		this.error = null;
		this.lastResult = null;
		try {
			const response = await LaunchService.configure(integrationId, model);
			if (response.success && response.result) {
				this.lastResult = response.result;
				this.selectedIntegrationId = integrationId;
			} else {
				this.error = response.error || 'Configuration failed';
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.isLoading = false;
		}
	}

	async generateEnvFile(integrationId: string, model?: string) {
		this.isGeneratingEnv = true;
		this.error = null;
		try {
			const response = await LaunchService.generateEnv(integrationId, model);
			if (!response.success) {
				this.error = response.error || 'Failed to generate env file';
			}
			return response;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			return { success: false, error: this.error };
		} finally {
			this.isGeneratingEnv = false;
		}
	}

	async openEnvFolder() {
		try {
			await LaunchService.openEnvFolder();
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	/** Check all integrations and populate `installStatuses`. */
	async checkAllInstalled() {
		this.isCheckingInstalled = true;
		this.error = null;
		try {
			const response = await LaunchService.checkAllInstalled();
			if (response.success && response.statuses) {
				this.installStatuses = response.statuses;
			} else {
				this.error = response.error || 'Failed to check installed integrations';
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.isCheckingInstalled = false;
		}
	}

	/** Check a single integration's install status and update `installStatuses`. */
	async checkInstalled(integrationId: string) {
		try {
			const response = await LaunchService.checkInstalled(integrationId);
			if (response.success && response.status) {
				this.installStatuses = { ...this.installStatuses, [integrationId]: response.status };
			}
			return response;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			return { success: false, error: this.error };
		}
	}

	/**
	 * Launch an integration's tool with Alpaca configuration. Checks install
	 * status first; if not installed, returns an error result without launching.
	 * Updates `lastLaunchResult` and `launchingIds` during the operation.
	 */
	async launchIntegration(integrationId: string, model?: string) {
		this.error = null;
		this.lastLaunchResult = null;
		this.launchingIds = new Set([...this.launchingIds, integrationId]);
		try {
			const response = await LaunchService.launchIntegration(integrationId, model);
			if (response.success && response.result) {
				this.lastLaunchResult = response.result;
				this.selectedIntegrationId = integrationId;
				// Refresh install status in case the launch revealed something
				if (!response.result.success) {
					await this.checkInstalled(integrationId);
				}
			} else {
				this.error = response.error || 'Launch failed';
			}
			return response;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			return { success: false, error: this.error };
		} finally {
			const next = new Set(this.launchingIds);
			next.delete(integrationId);
			this.launchingIds = next;
		}
	}

	get groupedIntegrations() {
		const groups: Record<string, LaunchIntegration[]> = {};
		for (const integration of this.integrations) {
			if (!groups[integration.category]) groups[integration.category] = [];
			groups[integration.category].push(integration);
		}
		return groups;
	}

	get selectedIntegration() {
		return this.integrations.find((i) => i.id === this.selectedIntegrationId) || null;
	}

	/** Helper: get the install status for a given integration ID. */
	getInstallStatus(integrationId: string): LaunchInstallStatus | null {
		return this.installStatuses[integrationId] || null;
	}

	/** Helper: is this integration currently being launched? */
	isLaunching(integrationId: string): boolean {
		return this.launchingIds.has(integrationId);
	}
}

export const launchStore = new LaunchStore();
