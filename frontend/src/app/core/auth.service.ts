import { Injectable, computed, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

/**
 * Sessão de autenticação (Google OAuth via Supabase Auth). O perfil de jogo
 * (Mana/XP/decks) só existe depois que public.users é populado pelo trigger
 * on_auth_user_created (ver db/schema.sql) no primeiro login.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;

  readonly session = signal<Session | null>(null);
  readonly userId = computed(() => this.session()?.user.id ?? null);
  readonly isAuthenticated = computed(() => this.session() !== null);

  private readonly initialSessionLoaded: Promise<Session | null>;

  constructor() {
    this.initialSessionLoaded = this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      return data.session;
    });

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
    });
  }

  /** Usado pelo authGuard: espera a sessão inicial (inclusive o retorno do redirect OAuth) resolver. */
  ensureSessionLoaded(): Promise<Session | null> {
    return this.initialSessionLoaded;
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }
}
