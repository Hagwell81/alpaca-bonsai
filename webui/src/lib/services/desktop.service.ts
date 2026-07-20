/**
 * **DesktopService** - Unified model management client (Electron IPC + HTTP fallback)
 *
 * Provides a single API for model management operations (listing installed
 * models, searching HuggingFace, downloading, deleting) that works both
 * inside the Electron desktop app and in the standalone webui.
 *
 * **Transport selection:**
 * - When `window.llamaAPI` is available (Electron desktop app), calls are
 *   routed through the secure IPC bridge exposed by `preload.js`.
 * - Otherwise (standalone webui in a browser), calls fall back to HTTP
 *   endpoints on the API gateway (`/v1/desktop/*` on port 13439).
 *
 * This ensures the desktop and standalone webui have feature parity for
 * model management — the settings UI no longer needs to gate features
 * behind an `isElectron` check.
 *
 * **Architecture:**
 * - DesktopService (this class): Stateless transport abstraction
 * - Components/stores: Call DesktopService methods without caring about transport
 * - Electron path: window.llamaAPI → ipcRenderer.invoke → main.js handlers
 * - HTTP path: fetch → API gateway (api-gateway.js) → desktopServices → main.js functions
 *
 * @see api-gateway.js `_handleGetInstalledModels` etc. for the HTTP endpoints
 * @see preload.js for the IPC bridge
 * @see main.js `getInstalledModels`, `searchHuggingFaceRepo`, etc. for the implementations
 */

export interface InstalledModel {
	filename: string;
	size: number;
	sizeFormatted: string;
	modified: string;
	path: string;
	hasMmproj: boolean;
	mmprojFiles: string[];
}

export interface HuggingFaceFile {
	filename: string;
	size: number;
	sizeFormatted: string;
}

/**
 * HuggingFace search result. All metadata fields are typed as required
 * (defaulting to empty values at the API layer) so template code doesn't
 * need to chase optional chaining through every property access.
 */
export interface HuggingFaceSearchResult {
	repoId: string;
	modelId: string;
	author: string;
	downloads: number;
	tags: string[];
	modelFiles: HuggingFaceFile[];
	mmprojFiles: HuggingFaceFile[];
	hasVisionSupport: boolean;
	error?: string;
	[key: string]: unknown;
}

export interface DownloadProgress {
	progress: number;
	status: string;
	filename?: string;
	[key: string]: unknown;
}

export interface DownloadStartResult {
	downloadId: string;
	started: boolean;
}

export interface DeleteModelResult {
	success: boolean;
	error?: string;
}

/**
 * Returns true when running inside the Electron desktop app (window.llamaAPI
 * is exposed by the preload script).
 */
export function isElectron(): boolean {
	return !!(typeof window !== 'undefined' && (window as any).llamaAPI);
}

/**
 * Base URL for the desktop HTTP API. Points to the API gateway on port 13439.
 *
 * In Electron (production), window.llamaAPI IPC is used instead and this
 * URL is never hit. In a standalone browser, requests go directly to the
 * API gateway — this requires the Electron desktop app to be running (it
 * starts the API gateway) and CORS to be permitted for the webui's origin.
 *
 * Override at runtime via `window.__DESKTOP_API_BASE__` if needed.
 */
const DESKTOP_API_BASE: string =
	(typeof window !== 'undefined' && (window as any).__DESKTOP_API_BASE__) ||
	'http://127.0.0.1:13439';

function getLlamaApi(): any {
	return (typeof window !== 'undefined') ? (window as any).llamaAPI : undefined;
}

export class DesktopService {
	/**
	 * List installed GGUF models on disk (excludes mmproj vision projectors).
	 */
	static async getInstalledModels(): Promise<InstalledModel[]> {
		const api = getLlamaApi();
		if (api?.getInstalledModels) {
			return api.getInstalledModels();
		}
		const res = await fetch(`${DESKTOP_API_BASE}/v1/desktop/installed-models`);
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${res.status}`);
		}
		const body = await res.json();
		return body.models ?? [];
	}

	/**
	 * Search a HuggingFace repository for downloadable GGUF files.
	 *
	 * @param repoId e.g. "TheBloke/Llama-2-7B-GGUF" or a full huggingface.co URL
	 * @param hfToken optional HuggingFace access token for private/gated repos
	 */
	static async searchHuggingFace(
		repoId: string,
		hfToken?: string
	): Promise<HuggingFaceSearchResult> {
		const api = getLlamaApi();
		if (api?.searchHuggingFace) {
			return api.searchHuggingFace(repoId, hfToken);
		}
		const res = await fetch(`${DESKTOP_API_BASE}/v1/desktop/huggingface/search`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repoId, hfToken })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${res.status}`);
		}
		return res.json();
	}

	/**
	 * Start a background download of a model file from HuggingFace.
	 *
	 * @param repoId e.g. "TheBloke/Llama-2-7B-GGUF"
	 * @param filename e.g. "llama-2-7b.Q4_K_M.gguf"
	 * @param hfToken optional HuggingFace access token
	 * @returns { downloadId, started } — poll progress via {@link getDownloadProgress}
	 */
	static async downloadHuggingFaceModel(
		repoId: string,
		filename: string,
		hfToken?: string
	): Promise<DownloadStartResult> {
		const api = getLlamaApi();
		if (api?.downloadHuggingFaceModel) {
			return api.downloadHuggingFaceModel(repoId, filename, hfToken);
		}
		const res = await fetch(`${DESKTOP_API_BASE}/v1/desktop/huggingface/download`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repoId, filename, hfToken })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${res.status}`);
		}
		return res.json();
	}

	/**
	 * Poll the progress of an in-progress download.
	 *
	 * @param downloadId the ID returned by {@link downloadHuggingFaceModel}
	 */
	static async getDownloadProgress(downloadId: string): Promise<DownloadProgress> {
		const api = getLlamaApi();
		if (api?.getDownloadProgress) {
			return api.getDownloadProgress(downloadId);
		}
		const res = await fetch(
			`${DESKTOP_API_BASE}/v1/desktop/download-progress?downloadId=${encodeURIComponent(downloadId)}`
		);
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${res.status}`);
		}
		return res.json();
	}

	/**
	 * Delete an installed model file from disk.
	 *
	 * @param filename the GGUF filename to delete
	 */
	static async deleteModel(filename: string): Promise<DeleteModelResult> {
		const api = getLlamaApi();
		if (api?.deleteModel) {
			return api.deleteModel(filename);
		}
		const res = await fetch(`${DESKTOP_API_BASE}/v1/desktop/models/delete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${res.status}`);
		}
		return res.json();
	}

	/**
	 * Subscribe to download-complete events. In Electron this uses the IPC
	 * event bridge; in the standalone webui this is a no-op (callers should
	 * poll {@link getDownloadProgress} instead).
	 *
	 * @returns an unsubscribe function, or null if not supported
	 */
	static onDownloadComplete(handler: (data: any) => void): (() => void) | null {
		const api = getLlamaApi();
		if (api?.onDownloadComplete) {
			api.onDownloadComplete(handler);
			return () => api.offDownloadComplete?.(handler);
		}
		return null;
	}

	/**
	 * Get all in-progress downloads (for resuming polling after a page reload).
	 * Only available in Electron; returns [] in standalone mode.
	 */
	static async getAllDownloadProgress(): Promise<DownloadProgress[]> {
		const api = getLlamaApi();
		if (api?.getAllDownloadProgress) {
			return api.getAllDownloadProgress();
		}
		return [];
	}
}
