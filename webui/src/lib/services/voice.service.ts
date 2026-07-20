/**
 * VoiceService - Stateless client for desktop voice APIs.
 *
 * Wraps window.llamaAPI voice methods to provide STT and TTS
 * functionality within the WebUI.
 */

export interface VoiceStatus {
	sttReady: boolean;
	ttsReady: boolean;
	ttsMode: 'browser' | 'moss';
	whisperBinaryReady: boolean;
	whisperModelReady: boolean;
	mossTtsAvailable: boolean;
}

export interface TranscribeResult {
	success: boolean;
	text?: string;
	language?: string;
	error?: string;
}

export interface SynthesizeResult {
	success: boolean;
	mode?: 'browser' | 'moss';
	audioBase64?: string;
	mimeType?: string;
	error?: string;
}

export class VoiceService {
	/**
	 * Get current voice service status from the desktop backend.
	 */
	static async getStatus(): Promise<VoiceStatus | null> {
		try {
			const api = window.llamaAPI;
			if (!api?.voiceGetStatus) return null;
			const res = await api.voiceGetStatus();
			return res.success ? (res.status as VoiceStatus) : null;
		} catch {
			return null;
		}
	}

	/**
	 * Transcribe an audio blob to text using whisper.cpp.
	 *
	 * @param audioBlob - Recorded audio blob (WAV format)
	 * @returns Transcription result
	 */
	static async transcribe(audioBlob: Blob): Promise<TranscribeResult> {
		try {
			const api = window.llamaAPI;
			if (!api?.voiceTranscribe) {
				return { success: false, error: 'Voice API not available' };
			}

			const arrayBuffer = await audioBlob.arrayBuffer();
			const base64Audio = VoiceService._arrayBufferToBase64(arrayBuffer);
			const res = await api.voiceTranscribe(base64Audio, 'wav');
			return res;
		} catch (err) {
			return { success: false, error: (err as Error).message };
		}
	}

	/**
	 * Synthesize speech from text.
	 *
	 * When the backend returns `mode: 'moss'` with audio data, this method
	 * creates an HTMLAudioElement and plays it. Otherwise it falls back
	 * to the browser's Web Speech API.
	 *
	 * @param text - Text to speak
	 * @param options - Optional voice/speed parameters
	 * @returns Synthesis result
	 */
	static async synthesize(text: string, options?: { voice?: string; speed?: number }): Promise<SynthesizeResult> {
		try {
			const api = window.llamaAPI;
			if (!api?.voiceSynthesize) {
				// Fallback to browser TTS directly
				VoiceService._speakWithBrowser(text);
				return { success: true, mode: 'browser' };
			}

			const res = await api.voiceSynthesize(text, options);
			if (!res.success) {
				VoiceService._speakWithBrowser(text);
				return { success: true, mode: 'browser' };
			}

			if (res.mode === 'moss' && res.audioBase64) {
				const audio = new Audio(`data:${res.mimeType || 'audio/wav'};base64,${res.audioBase64}`);
				audio.play();
				return { success: true, mode: 'moss' };
			}

			// Browser fallback
			VoiceService._speakWithBrowser(text);
			return { success: true, mode: 'browser' };
		} catch (err) {
			VoiceService._speakWithBrowser(text);
			return { success: true, mode: 'browser' };
		}
	}

	/**
	 * Download a whisper model for STT.
	 *
	 * @param modelName - Model filename (default: ggml-tiny.bin)
	 * @param url - Optional direct download URL
	 */
	static async downloadWhisperModel(modelName = 'ggml-tiny.bin', url?: string): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
		try {
			const api = window.llamaAPI;
			if (!api?.voiceDownloadModel) {
				return { success: false, error: 'Voice download API not available' };
			}
			return await api.voiceDownloadModel(modelName, url);
		} catch (err) {
			return { success: false, error: (err as Error).message };
		}
	}

	/**
	 * Check if the browser supports speech synthesis (TTS).
	 */
	static get browserTtsSupported(): boolean {
		return typeof window !== 'undefined' && 'speechSynthesis' in window;
	}

	/**
	 * Check if the browser supports audio recording (STT input).
	 */
	static get audioRecordingSupported(): boolean {
		return typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia);
	}

	/**
	 * Speak text using the browser's built-in speech synthesis.
	 */
	private static _speakWithBrowser(text: string): void {
		if (!window.speechSynthesis) return;
		const utterance = new SpeechSynthesisUtterance(text);
		window.speechSynthesis.speak(utterance);
	}

	private static _arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	}
}
