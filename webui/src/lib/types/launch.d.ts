export interface LaunchIntegration {
	id: string;
	name: string;
	category: string;
	provider: string;
	installUrl: string;
}

export interface LaunchConfigResult {
	integration: string;
	env: Record<string, string>;
	command?: string;
	instructions: string;
	manualCommand?: string;
	binaryPath?: string;
	configTip?: string;
	scriptPath?: string;
}

/** Result of checking whether an integration's tool is installed. */
export interface LaunchInstallStatus {
	installed: boolean;
	method: 'command' | 'app' | 'extra' | null;
	detail: string;
}

/** Result of launching an integration's tool with Alpaca configuration. */
export interface LaunchIntegrationResult {
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
