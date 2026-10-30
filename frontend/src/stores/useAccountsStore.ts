import { create } from 'zustand';
import type { Account } from '../types';
import { apiClient, showToast } from '../api/client';

interface AccountsState {
  accounts: Account[];
  isLoading: boolean;
  manualModalOpen: boolean;
  testingAccountId: string | null;
  isGuideOpen: boolean;
  guideTab: 'instagram' | 'facebook' | 'youtube';

  // Actions
  loadAccounts: () => Promise<void>;
  openManualModal: () => void;
  closeManualModal: () => void;
  openGuide: (tab?: 'instagram' | 'facebook' | 'youtube') => void;
  closeGuide: () => void;
  testConnection: (accountId: string) => Promise<void>;
  disconnectAccount: (accountId: string) => Promise<void>;
  manualConnect: (payload: any) => Promise<boolean>;
  autoConnectMeta: (token: string) => Promise<boolean>;
  syncEnvAccounts: () => Promise<void>;
  connectOAuth: (platform: 'youtube' | 'instagram') => void;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  isLoading: false,
  manualModalOpen: false,
  testingAccountId: null,
  isGuideOpen: false,
  guideTab: 'instagram',

  openGuide: (tab = 'instagram') => set({ isGuideOpen: true, guideTab: tab }),
  closeGuide: () => set({ isGuideOpen: false }),

  autoConnectMeta: async (token: string) => {
    try {
      const res = await apiClient.autoConnectMeta(token);
      showToast(
        `Automated Connect Success! Linked ${res.facebook_pages_count} Facebook Page(s) and ${res.instagram_accounts_count} Instagram Account(s)!`,
        'success'
      );
      get().loadAccounts();
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Auto-connect failed', 'error');
      return false;
    }
  },

  loadAccounts: async () => {
    set({ isLoading: true });
    try {
      const data = await apiClient.getAccounts();
      set({ accounts: data.accounts || [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  openManualModal: () => set({ manualModalOpen: true }),
  closeManualModal: () => set({ manualModalOpen: false }),

  testConnection: async (accountId: string) => {
    set({ testingAccountId: accountId });
    try {
      const res = await apiClient.testAccountConnection(accountId);
      const isOk = res.ok ?? (res as any).valid ?? false;
      if (isOk) {
        showToast(`Account valid: ${res.message || 'Connected'}`, 'success');
      } else {
        showToast(`Token issue: ${res.message || 'Action required'}`, 'warning');
      }
      get().loadAccounts();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Connection test failed', 'error');
    } finally {
      set({ testingAccountId: null });
    }
  },

  disconnectAccount: async (accountId: string) => {
    try {
      await apiClient.disconnectAccount(accountId);
      showToast('Account disconnected', 'info');
      get().loadAccounts();
    } catch {
      showToast('Failed to disconnect account', 'error');
    }
  },

  manualConnect: async (payload: any) => {
    try {
      const res = await apiClient.manualConnectAccount(payload);
      if (res.success) {
        showToast('Account connected successfully!', 'success');
        get().closeManualModal();
        get().loadAccounts();
        return true;
      } else {
        showToast(res.error || 'Failed to connect account', 'error');
        return false;
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Connection error', 'error');
      return false;
    }
  },

  syncEnvAccounts: async () => {
    try {
      const res = await apiClient.syncEnvAccounts();
      showToast(`Synced ${res.synced_count || 0} accounts from .env`, 'success');
      get().loadAccounts();
    } catch {
      showToast('Failed to sync accounts from .env', 'error');
    }
  },

  connectOAuth: (platform: 'youtube' | 'instagram') => {
    const endpoint = platform === 'youtube' ? '/accounts/youtube/login' : '/accounts/instagram/login';
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      endpoint,
      `${platform}_oauth`,
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );

    // Listen for auth completion message from popup
    const onMessage = (e: MessageEvent) => {
      if (e.data && (e.data.type === 'OAUTH_AUTH_SUCCESS' || e.data.type === 'account_connected')) {
        showToast(`${platform.toUpperCase()} connected successfully!`, 'success');
        window.removeEventListener('message', onMessage);
        get().loadAccounts();
        if (popup && !popup.closed) popup.close();
      }
    };

    window.addEventListener('message', onMessage);
  },
}));
