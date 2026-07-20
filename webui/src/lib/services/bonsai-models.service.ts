/**
 * BonsaiModelsService - Stateless client for the desktop bonsai model catalog.
 *
 * Wraps window.llamaAPI bonsai model methods so the onboarding/models UI can
 * list, check, and download the prerequisite Bonsai ternary, image, TTS, and
 * STT models. Mirrors bonsai-beach config/bonsai-beach.toml.
 */

export interface BonsaiModelFile {
	kind: string;
	filename: string;
	url: string;
	subdir?: string;
	optional?: boolean;
}

export interface BonsaiModelDefinition {
	id: string;
	displayName: string;
	kind: 'chat' | 'image' | 'tts' | 'stt';
	family: string;
	size?: string;
	enabled: boolean;
	port: number;
	quant?: string;
	mmprojQuant?: string;
	description?: string;
	files: BonsaiModelFile[];
}

export interface BonsaiMissingFile {
	modelId: string;
	kind: string;
	filename: string;
	url: string;
	dest: string;
}

export interface BonsaiDownloadProgress {
	id: string;
	progress: number;
	total: number;
	current: number;
	status: string;
	error?: string;
}

export interface BonsaiDownloadResult {
	success: boolean;
	skipped?: boolean;
	downloaded: number;
	errors?: Array<{ filename: string; error: string }>;
}

export class BonsaiModelsService {
	static async listModels(): Promise<BonsaiModelDefinition[]> {
		const api = window.llamaAPI;
		if (!api?.bonsaiListModels) return [];
		return api.bonsaiListModels();
	}

	static async listChatModels(): Promise<BonsaiModelDefinition[]> {
		const api = window.llamaAPI;
		if (!api?.bonsaiListChatModels) return [];
		return api.bonsaiListChatModels();
	}

	static async getImageModel(): Promise<BonsaiModelDefinition | null> {
		const api = window.llamaAPI;
		if (!api?.bonsaiGetImageModel) return null;
		return api.bonsaiGetImageModel();
	}

	static async listMissingFiles(modelId?: string): Promise<BonsaiMissingFile[]> {
		const api = window.llamaAPI;
		if (!api?.bonsaiListMissingFiles) return [];
		return api.bonsaiListMissingFiles(modelId);
	}

	static async downloadModel(modelId?: string): Promise<BonsaiDownloadResult> {
		const api = window.llamaAPI;
		if (!api?.bonsaiDownloadModel) return { success: false, downloaded: 0, errors: [{ filename: '', error: 'desktop API unavailable' }] };
		return api.bonsaiDownloadModel(modelId);
	}

	static async getDownloadProgress(modelId: string): Promise<BonsaiDownloadProgress[]> {
		const api = window.llamaAPI;
		if (!api?.bonsaiGetDownloadProgress) return [];
		return api.bonsaiGetDownloadProgress(modelId);
	}
}
