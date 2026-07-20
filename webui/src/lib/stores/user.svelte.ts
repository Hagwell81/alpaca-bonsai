/**
 * userStore - Reactive State Store for User Authentication
 *
 * Manages the current user session, login/register/logout flow,
 * and exposes user data to other stores for per-user data isolation.
 */

import { browser } from '$app/environment';
import { toast } from 'svelte-sonner';

interface User {
	id: string;
	username: string;
	email: string;
	bio: string;
	avatar: string;
	createdAt: number;
}

class UserStore {
	/** Currently authenticated user, or null if guest */
	currentUser = $state<User | null>(null);

	/** Whether the store has checked for an existing session */
	isInitialized = $state(false);

	/** Whether an auth operation is in progress */
	isLoading = $state(false);

	/**
	 * Initialize the store by checking for an existing session via Electron IPC.
	 */
	async init(): Promise<void> {
		if (!browser) return;
		if (this.isInitialized) return;

		try {
			const api = (window as any).llamaAPI;
			if (api?.getCurrentUser) {
				const user = await api.getCurrentUser();
				if (user) {
					this.currentUser = user;
				}
			}
		} catch (error) {
			console.error('Failed to check current user session:', error);
		} finally {
			this.isInitialized = true;
		}
	}

	/**
	 * Register a new user and log them in automatically.
	 */
	async register(username: string, password: string, email?: string, bio?: string): Promise<boolean> {
		if (!browser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.registerUser) {
				toast.error('User registration is not available in this environment');
				return false;
			}
			const result = await api.registerUser(username, password, email || '', bio || '');
			if (result.success) {
				this.currentUser = result.user;
				toast.success(`Welcome, ${result.user.username}!`);
				return true;
			} else {
				toast.error(result.error || 'Registration failed');
				return false;
			}
		} catch (error) {
			console.error('Registration error:', error);
			toast.error('Registration failed. Please try again.');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Log in an existing user.
	 */
	async login(username: string, password: string): Promise<boolean> {
		if (!browser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.loginUser) {
				toast.error('User login is not available in this environment');
				return false;
			}
			const result = await api.loginUser(username, password);
			if (result.success) {
				this.currentUser = result.user;
				toast.success(`Welcome back, ${result.user.username}!`);
				return true;
			} else {
				toast.error(result.error || 'Login failed');
				return false;
			}
		} catch (error) {
			console.error('Login error:', error);
			toast.error('Login failed. Please try again.');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Log out the current user.
	 */
	async logout(): Promise<void> {
		if (!browser) return;
		try {
			const api = (window as any).llamaAPI;
			if (api?.logoutUser) {
				await api.logoutUser();
			}
			this.currentUser = null;
			toast.success('Logged out successfully');
		} catch (error) {
			console.error('Logout error:', error);
		}
	}

	/**
	 * Update the current user's profile (email, bio, avatar).
	 */
	async updateProfile(updates: Partial<Pick<User, 'email' | 'bio' | 'avatar'>>): Promise<boolean> {
		if (!browser || !this.currentUser) return false;
		this.isLoading = true;
		try {
			const api = (window as any).llamaAPI;
			if (!api?.updateUserProfile) {
				toast.error('Profile update is not available');
				return false;
			}
			const result = await api.updateUserProfile(updates);
			if (result.success) {
				this.currentUser = { ...this.currentUser, ...updates };
				toast.success('Profile updated');
				return true;
			} else {
				toast.error(result.error || 'Update failed');
				return false;
			}
		} catch (error) {
			console.error('Profile update error:', error);
			toast.error('Failed to update profile');
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Get the current user ID for database filtering, or null for guest mode.
	 */
	getUserId(): string | null {
		return this.currentUser?.id ?? null;
	}

	/**
	 * Check whether a user is currently logged in.
	 */
	get isLoggedIn(): boolean {
		return this.currentUser !== null;
	}
}

export const userStore = new UserStore();
