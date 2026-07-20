import type { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import type { ChatMessagePromptProgress, ChatMessageTimings } from './chat';
import type { OpenAIToolDefinition } from './mcp';
import type { DatabaseMessageExtra } from './database';
import type { ParameterSource, SyncableParameterType, SettingsFieldType } from '$lib/enums';
import type { Icon } from '@lucide/svelte';

export type SettingsConfigValue = string | number | boolean | undefined;

export interface SettingsFieldConfig {
	key: string;
	label: string;
	type: SettingsFieldType;
	isExperimental?: boolean;
	help?: string;
	options?: Array<{ value: string; label: string; icon?: typeof Icon }>;
}

export interface SettingsChatServiceOptions {
	stream?: boolean;
	// Model (required in ROUTER mode, optional in MODEL mode)
	model?: string;
	// System message to inject
	systemMessage?: string;
	// Reasoning format (auto, none, deepseek)
	reasoningFormat?: string;
	// Strip reasoning content from context before sending
	excludeReasoningFromContext?: boolean;
	tools?: OpenAIToolDefinition[];
	// Generation parameters
	temperature?: number;
	max_tokens?: number;
	// Sampling parameters
	dynatemp_range?: number;
	dynatemp_exponent?: number;
	top_k?: number;
	top_p?: number;
	min_p?: number;
	xtc_probability?: number;
	xtc_threshold?: number;
	typ_p?: number;
	// Penalty parameters
	repeat_last_n?: number;
	repeat_penalty?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	dry_multiplier?: number;
	dry_base?: number;
	dry_allowed_length?: number;
	dry_penalty_last_n?: number;
	dry_sequence_breakers?: string | string[];
	// Sampler configuration
	samplers?: string | string[];
	backend_sampling?: boolean;
	// Advanced llama.cpp parameters
	seed?: number;
	mirostat?: number;
	mirostat_tau?: number;
	mirostat_eta?: number;
	n_keep?: number;
	n_discard?: number;
	ignore_eos?: boolean;
	grammar?: string;
	grammar_lazy?: boolean;
	stop?: string | string[];
	logit_bias?: Array<[number, number]>;
	n_probs?: number;
	min_keep?: number;
	top_n_sigma?: number;
	post_sampling_probs?: boolean;
	chat_format?: string;
	// Speculative decoding
	speculative_n_max?: number;
	speculative_n_min?: number;
	speculative_p_min?: number;
	// LoRA adapters
	lora?: string;
	// Custom parameters
	custom?: string;
	timings_per_token?: boolean;
	// Callbacks
	onChunk?: (chunk: string) => void;
	onReasoningChunk?: (chunk: string) => void;
	onToolCallChunk?: (chunk: string) => void;
	onAttachments?: (extras: DatabaseMessageExtra[]) => void;
	onModel?: (model: string) => void;
	onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void;
	onComplete?: (
		response: string,
		reasoningContent?: string,
		timings?: ChatMessageTimings,
		toolCalls?: string
	) => void;
	onError?: (error: Error) => void;
}

export type SettingsConfigType = typeof SETTING_CONFIG_DEFAULT & {
	[key: string]: SettingsConfigValue;
};

/**
 * Parameter synchronization types for server defaults and user overrides
 * Note: ParameterSource and SyncableParameterType enums are imported from '$lib/enums'
 */
export type ParameterValue = string | number | boolean;
export type ParameterRecord = Record<string, ParameterValue>;

export interface ParameterInfo {
	value: string | number | boolean;
	source: ParameterSource;
	serverDefault?: string | number | boolean;
	userOverride?: string | number | boolean;
}

export interface SyncableParameter {
	key: string;
	serverKey: string;
	type: SyncableParameterType;
	canSync: boolean;
}
