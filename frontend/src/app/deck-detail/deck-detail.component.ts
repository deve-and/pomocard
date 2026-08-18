import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { DeckCatalogService, ReviewCard } from '../core/deck-catalog.service';

/** Gerenciamento de um deck: ver todas as cartas, excluir cartas específicas ou o deck inteiro. */
@Component({
  selector: 'pc-deck-detail',
  standalone: true,
  imports: [CommonModule, ConfirmDialogComponent],
  templateUrl: './deck-detail.component.html',
  styleUrl: './deck-detail.component.scss',
})
export class DeckDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly deckCatalog = inject(DeckCatalogService);

  readonly deckId = signal('');
  readonly deckTitle = computed(() => this.deckCatalog.getDeckTitle(this.deckId()));
  readonly isLoading = signal(true);
  readonly cards = signal<ReviewCard[]>([]);

  readonly cardPendingDeletion = signal<ReviewCard | null>(null);
  readonly isDeckDeleteConfirmOpen = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('deckId') ?? '';
      this.deckId.set(id);
      this.isLoading.set(true);
      this.cards.set(await this.deckCatalog.getDeckFlashcards(id));
      this.isLoading.set(false);
    });
  }

  requestDeleteCard(card: ReviewCard): void {
    this.cardPendingDeletion.set(card);
  }

  async confirmDeleteCard(): Promise<void> {
    const card = this.cardPendingDeletion();
    if (!card) return;
    this.cardPendingDeletion.set(null);

    const succeeded = await this.deckCatalog.deleteFlashcard(card.id, this.deckId());
    if (succeeded) {
      this.cards.update((cards) => cards.filter((c) => c.id !== card.id));
    } else {
      this.errorMessage.set('Não foi possível excluir a carta. Tente novamente.');
    }
  }

  async confirmDeleteDeck(): Promise<void> {
    this.isDeckDeleteConfirmOpen.set(false);
    const succeeded = await this.deckCatalog.deleteDeck(this.deckId());
    if (succeeded) {
      this.router.navigate(['/']);
    } else {
      this.errorMessage.set('Não foi possível excluir o baralho. Tente novamente.');
    }
  }

  backToDashboard(): void {
    this.router.navigate(['/']);
  }
}
