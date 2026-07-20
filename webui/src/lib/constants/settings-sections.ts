/**
 * Settings section titles constants for ChatSettings component.
 *
 * These titles define the navigation sections in the settings dialog.
 * Used for both sidebar navigation and mobile horizontal scroll menu.
 */
export const SETTINGS_SECTION_TITLES = {
	GENERAL: 'General',
	DISPLAY: 'Display',
	VOICE: 'Voice',
	SAMPLING: 'Sampling',
	PENALTIES: 'Penalties',
	ADVANCED: 'Advanced',
	IMPORT_EXPORT: 'Import/Export',
	MCP: 'MCP',
	MODELS: 'Models',
	PROVIDERS: 'Providers',
	MULTI_MODEL: 'Multi-Model',
	INTEGRATIONS: 'Integrations',
	DEVELOPER: 'Developer',
	EXPERIMENTAL: 'Experimental'
} as const;

/** Type for settings section titles */
export type SettingsSectionTitle =
	(typeof SETTINGS_SECTION_TITLES)[keyof typeof SETTINGS_SECTION_TITLES];
