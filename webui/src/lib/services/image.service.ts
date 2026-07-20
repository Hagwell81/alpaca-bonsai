/**
 * ImageService - Stateless client for the desktop image generation API.
 *
 * Wraps window.llamaAPI image methods to provide local image generation
 * via sd.cpp (Bonsai Image 4B) within the WebUI.
 */

export interface ImageStatus {
	ready: boolean;
	sdCliPath: string | null;
	imageModel: BonsaiModelDefinition | null;
}

export interface ImageGenerateParams {
	prompt: string;
	negativePrompt?: string;
	width?: number;
	height?: number;
	steps?: number;
	cfgScale?: number;
	samplingMethod?: string;
	seed?: number;
	b64?: boolean;
}

export interface ImageGenerateResult {
	success: boolean;
	path?: string;
	b64?: string;
	error?: string;
}

interface BonsaiModelDefinition {
	id: string;
	displayName: string;
	kind: string;
	files: Array<{ kind: string; filename: string }>;
}

export class ImageService {
	static async getStatus(): Promise<ImageStatus | null> {
		try {
			const api = window.llamaAPI;
			if (!api?.imageGetStatus) return null;
			const res = await api.imageGetStatus();
			return res.success ? (res.status as ImageStatus) : null;
		} catch {
			return null;
		}
	}

	static async ensureReady(): Promise<{ success: boolean; ready?: boolean; missing?: string[]; error?: string }> {
		const api = window.llamaAPI;
		if (!api?.imageEnsureReady) return { success: false, error: 'desktop API unavailable' };
		return api.imageEnsureReady();
	}

	static async generate(params: ImageGenerateParams): Promise<ImageGenerateResult> {
		const api = window.llamaAPI;
		if (!api?.imageGenerate) return { success: false, error: 'desktop API unavailable' };
		return api.imageGenerate(params);
	}

	static async openImageFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
		const api = window.llamaAPI;
		if (!api?.imageOpenImageFolder) return { success: false, error: 'desktop API unavailable' };
		return api.imageOpenImageFolder();
	}
}
