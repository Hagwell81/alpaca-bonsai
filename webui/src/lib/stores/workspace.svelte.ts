/**
 * workspaceStore - Reactive State Store for Workspace Operations
 *
 * Manages the current workspace folder, sandbox state, and file tree.
 */

import { browser } from '$app/environment';
import { toast } from 'svelte-sonner';

export interface WorkspaceFileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children?: WorkspaceFileTreeNode[];
}

class WorkspaceStore {
	folderPath = $state<string | null>(null);
	isSandbox = $state(false);
	isLoading = $state(false);
	fileTree = $state<WorkspaceFileTreeNode[]>([]);
	isInitialized = $state(false);

	constructor() {
		if (browser) {
			this.loadState();
		}
	}

	/**
	 * Load workspace state from the backend.
	 */
	async loadState(): Promise<void> {
		if (!browser) return;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (api?.workspaceGetState) {
				const res = await api.workspaceGetState();
				if (res.success) {
					this.folderPath = res.folderPath ?? null;
					this.isSandbox = res.isSandbox ?? false;
					if (this.folderPath) {
						await this.loadFileTree();
					}
				}
			}
		} catch (error) {
			console.error('Failed to load workspace state:', error);
		} finally {
			this.isLoading = false;
			this.isInitialized = true;
		}
	}

	/**
	 * Set the workspace folder path.
	 */
	async setFolder(folderPath: string): Promise<boolean> {
		if (!browser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.workspaceSetFolder) {
				toast.error('Workspace API not available');
				return false;
			}
			const res = await api.workspaceSetFolder(folderPath);
			if (res.success) {
				this.folderPath = folderPath;
				this.isSandbox = false;
				await this.loadFileTree();
				toast.success('Workspace folder set');
				return true;
			} else {
				toast.error(res.error || 'Failed to set workspace folder');
				return false;
			}
		} catch (error) {
			console.error('Failed to set workspace folder:', error);
			toast.error('Failed to set workspace folder');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Open a sandbox workspace.
	 */
	async openSandbox(): Promise<boolean> {
		if (!browser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.workspaceOpenSandbox) {
				toast.error('Sandbox API not available');
				return false;
			}
			const res = await api.workspaceOpenSandbox();
			if (res.success) {
				this.folderPath = res.folderPath ?? null;
				this.isSandbox = true;
				await this.loadFileTree();
				toast.success('Sandbox workspace opened');
				return true;
			} else {
				toast.error(res.error || 'Failed to open sandbox');
				return false;
			}
		} catch (error) {
			console.error('Failed to open sandbox:', error);
			toast.error('Failed to open sandbox');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Get the current workspace folder path.
	 */
	getCurrentFolder(): string | null {
		return this.folderPath;
	}

	/**
	 * Load the file tree for the current folder.
	 */
	async loadFileTree(): Promise<void> {
		if (!browser || !this.folderPath) return;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (api?.workspaceGetFileTree) {
				const res = await api.workspaceGetFileTree(this.folderPath);
				if (res.success) {
					this.fileTree = res.tree ?? [];
				}
			}
		} catch (error) {
			console.error('Failed to load file tree:', error);
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Select a local folder using the system folder picker.
	 */
	async selectLocalFolder(): Promise<boolean> {
		if (!browser) return false;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.selectLocalFolder) {
				toast.error('Folder picker not available');
				return false;
			}
			const res = await api.selectLocalFolder();
			if (!res.canceled && res.folderPath) {
				return await this.setFolder(res.folderPath);
			}
			return false;
		} catch (error) {
			console.error('Failed to select folder:', error);
			toast.error('Failed to select folder');
			return false;
		}
	}
}

export const workspaceStore = new WorkspaceStore();
