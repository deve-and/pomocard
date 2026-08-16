import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * Cliente único do Supabase (Auth + Postgres via PostgREST). Todo acesso a
 * dados do usuário passa por aqui e é protegido pelas políticas de Row Level
 * Security definidas em db/schema.sql — o front nunca precisa filtrar
 * manualmente "só os meus dados", o banco já garante isso por auth.uid().
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
}
