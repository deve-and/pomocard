import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { SrsState } from './reward.service';
import { SupabaseService } from './supabase.service';

export interface DeckSummary {
  id: string;
  title: string;
  cardCount: number;
}

export interface ReviewCard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  srsState: SrsState;
}

interface DeckRow {
  id: string;
  title: string;
  flashcards: { count: number }[] | { count: number } | null;
}

interface FlashcardRow {
  id: string;
  deck_id: string;
  front_text: string;
  back_text: string;
  easiness_factor: number;
  repetitions: number;
  interval_days: number;
}

/**
 * Catálogo de decks + fila de revisão, lido direto de public.decks e
 * public.flashcards (ver db/schema.sql). Row Level Security já garante que
 * só os decks do usuário autenticado voltam nessas consultas.
 */
@Injectable({ providedIn: 'root' })
export class DeckCatalogService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  private readonly decksState = signal<DeckSummary[]>([]);
  private readonly dueCountState = signal<Record<string, number>>({});

  readonly decks = this.decksState.asReadonly();

  dueCount(deckId: string): number {
    return this.dueCountState()[deckId] ?? 0;
  }

  getDeckTitle(deckId: string): string {
    return this.decksState().find((deck) => deck.id === deckId)?.title ?? 'Deck';
  }

  async loadDecks(): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    const { data, error } = await this.supabase
      .from('decks')
      .select('id, title, flashcards(count)')
      .eq('owner_id', userId)
      .returns<DeckRow[]>();

    if (error || !data) {
      console.error('Falha ao carregar decks', error);
      return;
    }

    const decks: DeckSummary[] = data.map((row) => ({
      id: row.id,
      title: row.title,
      cardCount: Array.isArray(row.flashcards) ? (row.flashcards[0]?.count ?? 0) : (row.flashcards?.count ?? 0),
    }));
    this.decksState.set(decks);

    await this.refreshDueCounts(decks.map((deck) => deck.id));
  }

  private async refreshDueCounts(deckIds: string[]): Promise<void> {
    if (deckIds.length === 0) return;

    const { data, error } = await this.supabase
      .from('flashcards')
      .select('deck_id')
      .in('deck_id', deckIds)
      .lte('next_review_at', new Date().toISOString())
      .returns<{ deck_id: string }[]>();

    if (error || !data) {
      console.error('Falha ao carregar fila de revisão', error);
      return;
    }

    const counts: Record<string, number> = {};
    for (const row of data) {
      counts[row.deck_id] = (counts[row.deck_id] ?? 0) + 1;
    }
    this.dueCountState.set(counts);
  }

  async getDueCards(deckId: string): Promise<ReviewCard[]> {
    const { data, error } = await this.supabase
      .from('flashcards')
      .select('id, deck_id, front_text, back_text, easiness_factor, repetitions, interval_days')
      .eq('deck_id', deckId)
      .lte('next_review_at', new Date().toISOString())
      .order('next_review_at')
      .returns<FlashcardRow[]>();

    if (error || !data) {
      console.error('Falha ao carregar cartas para revisão', error);
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      deckId: row.deck_id,
      front: row.front_text,
      back: row.back_text,
      srsState: {
        easinessFactor: row.easiness_factor,
        repetitions: row.repetitions,
        intervalDays: row.interval_days,
      },
    }));
  }

  async createDeck(title: string): Promise<DeckSummary | null> {
    const userId = this.auth.userId();
    if (!userId) return null;

    const { data, error } = await this.supabase
      .from('decks')
      .insert({ owner_id: userId, title })
      .select('id, title')
      .single<{ id: string; title: string }>();

    if (error || !data) {
      console.error('Falha ao criar deck', error);
      return null;
    }

    const deck: DeckSummary = { id: data.id, title: data.title, cardCount: 0 };
    this.decksState.update((decks) => [...decks, deck]);
    return deck;
  }

  async createFlashcard(deckId: string, front: string, back: string): Promise<void> {
    const { error } = await this.supabase.from('flashcards').insert({
      deck_id: deckId,
      front_text: front,
      back_text: back,
    });
    if (error) {
      console.error('Falha ao criar flashcard', error);
      return;
    }

    this.decksState.update((decks) =>
      decks.map((deck) => (deck.id === deckId ? { ...deck, cardCount: deck.cardCount + 1 } : deck))
    );
    // Uma carta nova nasce com next_review_at = now(), então já entra na fila de revisão.
    this.dueCountState.update((counts) => ({ ...counts, [deckId]: (counts[deckId] ?? 0) + 1 }));
  }

  async submitCardReview(
    card: ReviewCard,
    quality: number,
    schedule: { easinessFactor: number; repetitions: number; intervalDays: number; nextReviewAt: string },
    manaEarned: number
  ): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;

    const { error: updateError } = await this.supabase
      .from('flashcards')
      .update({
        easiness_factor: schedule.easinessFactor,
        repetitions: schedule.repetitions,
        interval_days: schedule.intervalDays,
        next_review_at: schedule.nextReviewAt,
        last_reviewed_at: new Date().toISOString(),
        last_quality: quality,
      })
      .eq('id', card.id);
    if (updateError) console.error('Falha ao atualizar agendamento SM-2', updateError);

    const { error: reviewError } = await this.supabase.from('card_reviews').insert({
      flashcard_id: card.id,
      user_id: userId,
      quality,
      easiness_factor_after: schedule.easinessFactor,
      interval_days_after: schedule.intervalDays,
      mana_earned: manaEarned,
    });
    if (reviewError) console.error('Falha ao registrar log de revisão', reviewError);

    this.dueCountState.update((counts) => ({
      ...counts,
      [card.deckId]: Math.max(0, (counts[card.deckId] ?? 1) - 1),
    }));
  }
}
