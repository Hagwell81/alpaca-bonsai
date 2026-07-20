<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { userStore } from '$lib/stores/user.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { providersStore } from '$lib/stores/providers.svelte';
	import { User, LogOut, UserCircle } from '@lucide/svelte';

	let open = $state(false);
	let activeTab = $state<'login' | 'register'>('login');

	// Login fields
	let loginUsername = $state('');
	let loginPassword = $state('');

	// Register fields
	let regUsername = $state('');
	let regPassword = $state('');
	let regConfirmPassword = $state('');
	let regEmail = $state('');
	let regBio = $state('');

	let isSubmitting = $state(false);
	let errorMessage = $state('');

	async function handleLogin() {
		if (!loginUsername.trim() || !loginPassword.trim()) {
			errorMessage = 'Please enter username and password';
			return;
		}
		isSubmitting = true;
		errorMessage = '';
		const success = await userStore.login(loginUsername.trim(), loginPassword);
		if (success) {
			await conversationsStore.reloadForUser();
			await providersStore.reload();
			open = false;
			loginUsername = '';
			loginPassword = '';
		} else {
			errorMessage = userStore.isLoading ? '' : 'Invalid username or password';
		}
		isSubmitting = false;
	}

	async function handleRegister() {
		if (!regUsername.trim() || !regPassword.trim()) {
			errorMessage = 'Username and password are required';
			return;
		}
		if (regPassword !== regConfirmPassword) {
			errorMessage = 'Passwords do not match';
			return;
		}
		isSubmitting = true;
		errorMessage = '';
		const success = await userStore.register(regUsername.trim(), regPassword, regEmail, regBio);
		if (success) {
			await conversationsStore.reloadForUser();
			await providersStore.reload();
			open = false;
			regUsername = '';
			regPassword = '';
			regConfirmPassword = '';
			regEmail = '';
			regBio = '';
		}
		isSubmitting = false;
	}

	async function handleLogout() {
		await userStore.logout();
		await conversationsStore.reloadForUser();
		await providersStore.reload();
		open = false;
	}

	export function triggerOpen() {
		open = true;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[420px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{#if userStore.isLoggedIn}
					<UserCircle class="h-5 w-5" />
					Account
				{:else}
					<User class="h-5 w-5" />
					User Account
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if userStore.isLoggedIn}
					Manage your account session.
				{:else}
					Login or create an account to keep chats private and persistent.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if userStore.isLoggedIn && userStore.currentUser}
			<div class="space-y-4 py-2">
				<div class="rounded-lg bg-muted p-4">
					<p class="font-medium">{userStore.currentUser.username}</p>
					{#if userStore.currentUser.email}
						<p class="text-sm text-muted-foreground">{userStore.currentUser.email}</p>
					{/if}
					{#if userStore.currentUser.bio}
						<p class="mt-2 text-sm text-muted-foreground">{userStore.currentUser.bio}</p>
					{/if}
				</div>
				<Button variant="destructive" class="w-full" onclick={handleLogout}>
					<LogOut class="mr-2 h-4 w-4" />
					Logout
				</Button>
			</div>
		{:else}
			<div class="flex gap-2 py-2">
				<Button
					variant={activeTab === 'login' ? 'default' : 'outline'}
					class="flex-1"
					onclick={() => { activeTab = 'login'; errorMessage = ''; }}
				>
					Login
				</Button>
				<Button
					variant={activeTab === 'register' ? 'default' : 'outline'}
					class="flex-1"
					onclick={() => { activeTab = 'register'; errorMessage = ''; }}
				>
					Register
				</Button>
			</div>

			{#if errorMessage}
				<div class="mt-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
					{errorMessage}
				</div>
			{/if}

			{#if activeTab === 'login'}
				<div class="space-y-3 py-2">
					<div>
						<Label for="login-username">Username</Label>
						<Input id="login-username" bind:value={loginUsername} placeholder="Username" />
					</div>
					<div>
						<Label for="login-password">Password</Label>
						<Input id="login-password" type="password" bind:value={loginPassword} placeholder="Password" />
					</div>
					<Button class="w-full" onclick={handleLogin} disabled={isSubmitting}>
						{isSubmitting ? 'Logging in...' : 'Login'}
					</Button>
				</div>
			{:else}
				<div class="space-y-3 py-2">
					<div>
						<Label for="reg-username">Username *</Label>
						<Input id="reg-username" bind:value={regUsername} placeholder="Username" />
					</div>
					<div>
						<Label for="reg-password">Password *</Label>
						<Input id="reg-password" type="password" bind:value={regPassword} placeholder="Password" />
					</div>
					<div>
						<Label for="reg-confirm">Confirm Password *</Label>
						<Input id="reg-confirm" type="password" bind:value={regConfirmPassword} placeholder="Confirm password" />
					</div>
					<div>
						<Label for="reg-email">Email (optional)</Label>
						<Input id="reg-email" type="email" bind:value={regEmail} placeholder="you@example.com" />
					</div>
					<div>
						<Label for="reg-bio">Bio (optional)</Label>
						<Input id="reg-bio" bind:value={regBio} placeholder="Short bio..." />
					</div>
					<Button class="w-full" onclick={handleRegister} disabled={isSubmitting}>
						{isSubmitting ? 'Creating account...' : 'Create Account'}
					</Button>
				</div>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
