import React, { useState } from 'react';
import { X, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll';

export const AuthModal: React.FC = () => {
  const { authModalOpen, closeAuthModal, authTab, setAuthTab, login, signup, isLoading } =
    useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');

  useLockBodyScroll(authModalOpen);

  if (!authModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authTab === 'login') {
      await login(username, password);
    } else {
      await signup({ username, email, password, full_name: fullName });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in"
      onClick={closeAuthModal}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-5 right-5 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
          onClick={closeAuthModal}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">
            {authTab === 'login' ? 'Welcome Back' : 'Create ClipForge Account'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {authTab === 'login'
              ? 'Log in to sync your social accounts & publishing history'
              : 'Sign up to start auto-slicing and publishing'}
          </p>
        </div>

        {/* Auth Tabs */}
        <div className="flex p-1.5 rounded-2xl bg-slate-900 border border-white/10 mb-5">
          <button
            type="button"
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${authTab === 'login'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
              }`}
            onClick={() => setAuthTab('login')}
          >
            Log In
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${authTab === 'signup'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
              }`}
            onClick={() => setAuthTab('signup')}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Username</label>
            <input
              type="text"
              required
              className="glass-input px-3.5 py-2.5 rounded-xl text-xs w-full placeholder:text-slate-500 focus:outline-none"
              placeholder="e.g. johndoe"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          {authTab === 'signup' && (
            <>
              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1.5">Full Name</label>
                <input
                  type="text"
                  className="glass-input px-3.5 py-2.5 rounded-xl text-xs w-full placeholder:text-slate-500 focus:outline-none"
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  className="glass-input px-3.5 py-2.5 rounded-xl text-xs w-full placeholder:text-slate-500 focus:outline-none"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <label className="text-xs text-slate-400 font-semibold block mb-1.5">Password</label>
            <input
              type="password"
              required
              className="glass-input px-3.5 py-2.5 rounded-xl text-xs w-full placeholder:text-slate-500 focus:outline-none"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition-all cursor-pointer flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...
              </>
            ) : authTab === 'login' ? (
              'Log In'
            ) : (
              'Create Account'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
