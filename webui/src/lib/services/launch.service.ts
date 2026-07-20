import type {
	LaunchConfigResult,
	LaunchIntegration,
	LaunchInstallStatus,
	LaunchIntegrationResult
} from '$lib/types';

export class LaunchService {
	static async listIntegrations(): Promise<{ success: boolean; integrations?: LaunchIntegration[]; error?: string }> {
		return window.llamaAPI!.launchListIntegrations();
	}

	static async configure(integrationId: string, model?: string): Promise<{ success: boolean; result?: LaunchConfigResult; error?: string }> {
		return window.llamaAPI!.launchConfigure(integrationId, model);
	}

	static async generateEnv(integrationId: string, model?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
		return window.llamaAPI!.launchGenerateEnv(integrationId, model);
	}

	static async openEnvFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
		return window.llamaAPI!.launchOpenEnvFolder();
	}

	static async checkInstalled(integrationId: string): Promise<{ success: boolean; status?: LaunchInstallStatus; error?: string }> {
		return window.llamaAPI!.launchCheckInstalled(integrationId);
	}

	static async checkAllInstalled(): Promise<{ success: boolean; statuses?: Record<string, LaunchInstallStatus>; error?: string }> {
		return window.llamaAPI!.launchCheckAllInstalled();
	}

	static async launchIntegration(integrationId: string, model?: string): Promise<{ success: boolean; result?: LaunchIntegrationResult; error?: string }> {
		return window.llamaAPI!.launchLaunchIntegration(integrationId, model);
	}
}
