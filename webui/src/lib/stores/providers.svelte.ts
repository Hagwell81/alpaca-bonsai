/**
 * providersStore - Reactive state management for custom OpenAI-compatible providers
 *
 * Manages user-defined API provider configurations with secure backend storage.
 * Credentials are encrypted and stored per-user in the Electron main process.
 * If no user is authenticated, credentials are not persisted.
 *
 * **Architecture:**
 * - **providersStore** (this class): Manages provider list state
 *   - Loads from backend on initialization when user is logged in
 *   - Provides CRUD operations for provider configurations
 *   - Exposes reactive provider list for UI components
 *
 * **Security:**
 * - API keys never stored in localStorage or browser memory longer than necessary
 * - Encrypted via Electron safeStorage (OS keychain integration)
 * - Per-user isolation: each user only sees their own providers
 * - Guest users: no persistence, UI shows auth warning
 */

import { browser } from '$app/environment';
import { toast } from 'svelte-sonner';

export interface CustomProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	models?: string[];
	createdAt: number;
	updatedAt: number;
}

class ProvidersStore {
	providers = $state<CustomProvider[]>([]);
	isLoading = $state(false);
	isInitialized = $state(false);

	constructor() {
		if (browser) {
			this.init();
		}
	}

	/**
	 * Initialize by loading providers from the secure backend store.
	 */
	async init(): Promise<void> {
		if (!browser) return;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (api?.getProviderCredentials) {
				const result = await api.getProviderCredentials();
				if (result.success) {
					this.providers = result.providers || [];
				} else {
					// Auth required or other error - leave empty, UI will show warning
					this.providers = [];
				}
			}
		} catch (error) {
			console.error('Failed to load provider credentials:', error);
		} finally {
			this.isLoading = false;
			this.isInitialized = true;
		}
	}

	/**
	 * Add or update a provider credential.
	 * Returns true on success, false on failure.
	 */
	async saveProvider(
		id: string,
		name: string,
		baseUrl: string,
		apiKey: string,
		models?: string[]
	): Promise<boolean> {
		if (!browser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.setProviderCredential) {
				toast.error('Provider management is not available in this environment');
				return false;
			}
			const result = await api.setProviderCredential(id, name, baseUrl, apiKey, models || []);
			if (result.success) {
				// Update local state
				const idx = this.providers.findIndex((p) => p.id === id);
				const provider: CustomProvider = {
					id,
					name,
					baseUrl,
					apiKey: apiKey || '',
					models: models || [],
					createdAt: result.provider?.createdAt || Date.now(),
					updatedAt: result.provider?.updatedAt || Date.now()
				};
				if (idx >= 0) {
					this.providers[idx] = provider;
				} else {
					this.providers.push(provider);
				}
				toast.success(`Provider "${name}" saved`);
				return true;
			} else {
				toast.error(result.error || 'Failed to save provider');
				return false;
			}
		} catch (error) {
			console.error('Save provider error:', error);
			toast.error('Failed to save provider');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Delete a provider credential.
	 */
	async deleteProvider(id: string): Promise<boolean> {
		if (!browser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.deleteProviderCredential) {
				toast.error('Provider management is not available in this environment');
				return false;
			}
			const result = await api.deleteProviderCredential(id);
			if (result.success) {
				this.providers = this.providers.filter((p) => p.id !== id);
				toast.success('Provider removed');
				return true;
			} else {
				toast.error(result.error || 'Failed to remove provider');
				return false;
			}
		} catch (error) {
			console.error('Delete provider error:', error);
			toast.error('Failed to remove provider');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Reload providers after login/logout events.
	 */
	async reload(): Promise<void> {
		this.isInitialized = false;
		await this.init();
	}
}

export const providersStore = new ProvidersStore();
