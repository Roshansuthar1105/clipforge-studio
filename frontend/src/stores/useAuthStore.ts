import { create } from 'zustand';
import type { User } from '../types';
import { apiClient, showToast } from '../api/client';

interface AuthState {
  user: User | null;
  token: string | null;
  dbConnected: boolean;
  authModalOpen: boolean;
  authTab: 'login' | 'signup';
  isLoading: boolean;
  
  // Actions
  initAuth: () => Promise<void>;
  checkDbStatus: () => Promise<void>;
  openAuthModal: (tab?: 'login' | 'signup') => void;
  closeAuthModal: () => void;
  setAuthTab: (tab: 'login' | 'signup') => void;
  login: (username: string, password: string) => Promise<boolean>;
  signup: (payload: { username: string; email: string; password: string; full_name?: string }) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('clipforge_token'),
  dbConnected: true,
  authModalOpen: false,
  authTab: 'login',
  isLoading: false,

  initAuth: async () => {
    const token = localStorage.getItem('clipforge_token');
    if (!token) return;
    try {
      const data = await apiClient.getMe();
      if (data && data.user) {
        set({ user: data.user, token });
      }
    } catch {
      localStorage.removeItem('clipforge_token');
      set({ user: null, token: null });
    }
  },

  checkDbStatus: async () => {
    try {
      const data = await apiClient.getDbStatus();
      set({ dbConnected: !!data.db_connected });
    } catch {
      set({ dbConnected: false });
    }
  },

  openAuthModal: (tab = 'login') => set({ authModalOpen: true, authTab: tab }),
  closeAuthModal: () => set({ authModalOpen: false }),
  setAuthTab: (tab) => set({ authTab: tab }),

  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const data = await apiClient.login({ username, password });
      localStorage.setItem('clipforge_token', data.token);
      set({ user: data.user, token: data.token, authModalOpen: false });
      showToast(`Welcome back, ${data.user.username}!`, 'success');
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Invalid username or password', 'error');
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  signup: async (payload) => {
    set({ isLoading: true });
    try {
      const data = await apiClient.signup(payload);
      localStorage.setItem('clipforge_token', data.token);
      set({ user: data.user, token: data.token, authModalOpen: false });
      showToast(`Account created successfully! Welcome, ${data.user.username}!`, 'success');
      return true;
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to create account', 'error');
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    await apiClient.logout();
    localStorage.removeItem('clipforge_token');
    set({ user: null, token: null });
    showToast('Logged out successfully', 'info');
  },
}));
