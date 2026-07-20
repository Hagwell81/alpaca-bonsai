// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

// Import chat types from dedicated module

import type {
	// API types
	ApiChatCompletionRequest,
	ApiChatCompletionResponse,
	ApiChatCompletionStreamChunk,
	ApiChatCompletionToolCall,
	ApiChatCompletionToolCallDelta,
	ApiChatMessageData,
	ApiChatMessageContentPart,
	ApiContextSizeError,
	ApiErrorResponse,
	ApiLlamaCppServerProps,
	ApiModelDataEntry,
	ApiModelListResponse,
	ApiProcessingState,
	ApiRouterModelMeta,
	ApiRouterModelsLoadRequest,
	ApiRouterModelsLoadResponse,
	ApiRouterModelsStatusRequest,
	ApiRouterModelsStatusResponse,
	ApiRouterModelsListResponse,
	ApiRouterModelsUnloadRequest,
	ApiRouterModelsUnloadResponse,
	// Chat types
	ChatAttachmentDisplayItem,
	ChatAttachmentPreviewItem,
	ChatMessageType,
	ChatRole,
	ChatUploadedFile,
	ChatMessageSiblingInfo,
	ChatMessagePromptProgress,
	ChatMessageTimings,
	// Database types
	DatabaseConversation,
	DatabaseMessage,
	DatabaseMessageExtra,
	DatabaseMessageExtraAudioFile,
	DatabaseMessageExtraImageFile,
	DatabaseMessageExtraTextFile,
	DatabaseMessageExtraPdfFile,
	DatabaseMessageExtraLegacyContext,
	ExportedConversation,
	ExportedConversations,
	// Model types
	ModelModalities,
	ModelOption,
	// Settings types
	SettingsChatServiceOptions,
	SettingsConfigValue,
	SettingsFieldConfig,
	SettingsConfigType,
	// Knowledge Base types
	KnowledgeBaseCollection,
	KnowledgeBaseDocument,
	KnowledgeBaseSearchResult,
	KnowledgeBaseChunk
} from '$lib/types';

import { ServerRole, ServerModelStatus, ModelModality } from '$lib/enums';

declare global {
	// namespace App {
	// interface Error {}
	// interface Locals {}
	// interface PageData {}
	// interface PageState {}
	// interface Platform {}
	// }

	export {
		// API types
		ApiChatCompletionRequest,
		ApiChatCompletionResponse,
		ApiChatCompletionStreamChunk,
		ApiChatCompletionToolCall,
		ApiChatCompletionToolCallDelta,
		ApiChatMessageData,
		ApiChatMessageContentPart,
		ApiContextSizeError,
		ApiErrorResponse,
		ApiLlamaCppServerProps,
		ApiModelDataEntry,
		ApiModelListResponse,
		ApiProcessingState,
		ApiRouterModelMeta,
		ApiRouterModelsLoadRequest,
		ApiRouterModelsLoadResponse,
		ApiRouterModelsStatusRequest,
		ApiRouterModelsStatusResponse,
		ApiRouterModelsListResponse,
		ApiRouterModelsUnloadRequest,
		ApiRouterModelsUnloadResponse,
		// Chat types
		ChatAttachmentDisplayItem,
		ChatAttachmentPreviewItem,
		ChatMessagePromptProgress,
		ChatMessageSiblingInfo,
		ChatMessageTimings,
		ChatMessageType,
		ChatRole,
		ChatUploadedFile,
		// Database types
		DatabaseConversation,
		DatabaseMessage,
		DatabaseMessageExtra,
		DatabaseMessageExtraAudioFile,
		DatabaseMessageExtraImageFile,
		DatabaseMessageExtraTextFile,
		DatabaseMessageExtraPdfFile,
		DatabaseMessageExtraLegacyContext,
		ExportedConversation,
		ExportedConversations,
		// Enum types
		ModelModality,
		ServerRole,
		ServerModelStatus,
		// Model types
		ModelModalities,
		ModelOption,
		// Settings types
		SettingsChatServiceOptions,
		SettingsConfigValue,
		SettingsFieldConfig,
		SettingsConfigType
	};
}

interface LlamaAPI {
	getServerStatus: () => Promise<boolean>;
	startServer: () => Promise<boolean>;
	stopServer: () => Promise<boolean>;
	downloadModels: () => Promise<void>;
	getModelsDirectory: () => Promise<string>;
	setSelectedModels: (modelNames: string[]) => Promise<void>;
	getSelectedModels: () => Promise<string[]>;
	getAppDataDirectory: () => Promise<string>;
	openDataFolder: () => Promise<void>;
	getInstalledModels: () => Promise<string[]>;
	deleteModel: (filename: string) => Promise<void>;
	switchModel: (filename: string) => Promise<void>;
	searchHuggingFace: (repoId: string, hfToken?: string) => Promise<any>;
	downloadHuggingFaceModel: (repoId: string, filename: string, hfToken?: string) => Promise<any>;
	getDownloadProgress: (downloadId: string) => Promise<any>;
	getAllDownloadProgress: () => Promise<any>;
	getStorageInfo: () => Promise<any>;
	goBackToMain: () => Promise<void>;
	onDownloadComplete: (callback: (data: any) => void) => void;
	offDownloadComplete: (callback: (data: any) => void) => void;
	registerUser: (username: string, password: string, email?: string, bio?: string) => Promise<any>;
	loginUser: (username: string, password: string) => Promise<any>;
	getCurrentUser: () => Promise<any>;
	logoutUser: () => Promise<void>;
	updateUserProfile: (updates: Record<string, unknown>) => Promise<any>;
	webSearch: (query: string, maxResults?: number) => Promise<{ success: boolean; results?: Array<{ title: string; url: string; snippet: string }>; error?: string }>;
	fetchWebPage: (url: string) => Promise<{ success: boolean; content?: string; url?: string; error?: string }>;
	// Embedded jCodeMunch code retrieval
	jcmHealthCheck: () => Promise<{ available: boolean; error?: string }>;
	jcmIndexRepo: (repoUrl: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmIndexFolder: (folderPath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmSearchSymbols: (repo: string, query: string, maxResults?: number, kind?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetSymbolSource: (repo: string, symbolId: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmListRepos: () => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetRepoOutline: (repo: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetFileTree: (repo: string, pathPrefix?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetFileContent: (repo: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetContextBundle: (repo: string, symbolId: string, includeCallers?: boolean) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetFileOutline: (repo: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmInvalidateCache: (repo: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	// Local folder picker
	selectLocalFolder: () => Promise<{ canceled: boolean; folderPath?: string }>;
	// Voice service
	voiceGetStatus: () => Promise<{ success: boolean; status?: VoiceServiceStatus; error?: string }>;
	voiceTranscribe: (base64Audio: string, format: string) => Promise<{ success: boolean; text?: string; language?: string; error?: string }>;
	voiceSynthesize: (text: string, options?: { voice?: string; speed?: number }) => Promise<{ success: boolean; mode?: 'browser' | 'moss'; audioBase64?: string; mimeType?: string; error?: string }>;
	voiceDownloadModel: (modelName: string, url?: string) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
	// Knowledge Base
	kbGetCollections: () => Promise<{ success: boolean; collections?: KnowledgeBaseCollection[]; error?: string }>;
	kbCreateCollection: (name: string, description?: string) => Promise<{ success: boolean; collection?: KnowledgeBaseCollection; error?: string }>;
	kbDeleteCollection: (id: string) => Promise<{ success: boolean; error?: string }>;
	kbIngestDocuments: (collectionId: string, filePaths: string[]) => Promise<{ success: boolean; documents?: KnowledgeBaseDocument[]; error?: string }>;
	kbIngestUrl: (collectionId: string, url: string) => Promise<{ success: boolean; document?: KnowledgeBaseDocument; error?: string }>;
	kbSearch: (collectionId: string, query: string, topK?: number) => Promise<{ success: boolean; results?: KnowledgeBaseSearchResult[]; error?: string }>;
	kbGetDocuments: (collectionId: string) => Promise<{ success: boolean; documents?: KnowledgeBaseDocument[]; error?: string }>;
	kbDeleteDocument: (collectionId: string, docId: string) => Promise<{ success: boolean; error?: string }>;
	// Workspace
	workspaceGetState: () => Promise<{ success: boolean; folderPath?: string; isSandbox?: boolean; error?: string }>;
	workspaceSetFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
	workspaceOpenSandbox: () => Promise<{ success: boolean; folderPath?: string; error?: string }>;
	workspaceGetFileTree: (folderPath?: string) => Promise<{ success: boolean; tree?: WorkspaceFileTreeNode[]; error?: string }>;
	// Launch Service (Ollama-style integrations)
	launchListIntegrations: () => Promise<{ success: boolean; integrations?: LaunchIntegration[]; error?: string }>;
	launchConfigure: (integrationId: string, model?: string) => Promise<{ success: boolean; result?: LaunchConfigResult; error?: string }>;
	launchGenerateEnv: (integrationId: string, model?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
	launchOpenEnvFolder: () => Promise<{ success: boolean; path?: string; error?: string }>;
	launchCheckInstalled: (integrationId: string) => Promise<{ success: boolean; status?: LaunchInstallStatus; error?: string }>;
	launchCheckAllInstalled: () => Promise<{ success: boolean; statuses?: Record<string, LaunchInstallStatus>; error?: string }>;
	launchLaunchIntegration: (integrationId: string, model?: string) => Promise<{ success: boolean; result?: LaunchIntegrationResult; error?: string }>;
	// Bonsai model catalog (mirrors bonsai-beach config/bonsai-beach.toml)
	bonsaiListModels: () => Promise<BonsaiModelDefinition[]>;
	bonsaiListChatModels: () => Promise<BonsaiModelDefinition[]>;
	bonsaiGetImageModel: () => Promise<BonsaiModelDefinition | null>;
	bonsaiListMissingFiles: (modelId?: string) => Promise<BonsaiMissingFile[]>;
	bonsaiDownloadModel: (modelId?: string) => Promise<{ success: boolean; skipped?: boolean; downloaded: number; errors?: Array<{ filename: string; error: string }> }>;
	bonsaiGetDownloadProgress: (modelId: string) => Promise<Array<{ id: string; progress: number; total: number; current: number; status: string; error?: string }>>;
	// Image Service (sd.cpp / Bonsai Image 4B)
	imageGetStatus: () => Promise<{ success: boolean; status?: ImageServiceStatus; error?: string }>;
	imageEnsureReady: () => Promise<{ success: boolean; ready?: boolean; missing?: string[]; error?: string }>;
	imageGenerate: (params: ImageGenerateParams) => Promise<{ success: boolean; path?: string; b64?: string; error?: string }>;
	imageOpenImageFolder: () => Promise<{ success: boolean; path?: string; error?: string }>;

}

interface ImageServiceStatus {
	ready: boolean;
	sdCliPath: string | null;
	imageModel: BonsaiModelDefinition | null;
}

interface ImageGenerateParams {
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

interface BonsaiModelFile {
	kind: string;
	filename: string;
	url: string;
	subdir?: string;
	optional?: boolean;
}

interface BonsaiModelDefinition {
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

interface BonsaiMissingFile {
	modelId: string;
	kind: string;
	filename: string;
	url: string;
	dest: string;
}

interface VoiceServiceStatus {
	sttReady: boolean;
	ttsReady: boolean;
	ttsMode: 'browser' | 'moss';
	whisperBinaryReady: boolean;
	whisperModelReady: boolean;
	mossTtsAvailable: boolean;
}

interface WorkspaceFileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children?: WorkspaceFileTreeNode[];
}

declare global {
	interface Window {
		idxThemeStyle?: number;
		idxCodeBlock?: number;
		llamaAPI?: LlamaAPI;
	}
}


interface LaunchIntegration {
	id: string;
	name: string;
	category: string;
	provider: string;
	installUrl: string;
}

interface LaunchConfigResult {
	integration: string;
	env: Record<string, string>;
	command?: string;
	instructions: string;
	manualCommand?: string;
	binaryPath?: string;
	configTip?: string;
	scriptPath?: string;
}

interface LaunchInstallStatus {
	installed: boolean;
	method: 'command' | 'app' | 'extra' | null;
	detail: string;
}

interface LaunchIntegrationResult {
	success: boolean;
	launched?: boolean;
	error?: string;
	message?: string;
	manualCommand?: string;
	env?: Record<string, string>;
	instructions?: string;
	configTip?: string;
	installDetail?: string;
}
