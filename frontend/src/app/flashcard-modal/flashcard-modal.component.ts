import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface DeckOption {
  id: string;
  title: string;
}

export interface FlashcardDraft {
  /** Preenchido quando um deck existente foi escolhido. */
  deckId?: string;
  /** Preenchido quando o usuário optou por criar um deck novo na hora. */
  newDeckTitle?: string;
  front: string;
  back: string;
}

/** Valor sentinela do <select> que representa "criar um deck novo". */
const NEW_DECK_OPTION = '__new__';

/**
 * Modal exibido ao final do Pomodoro (regra de negócio 1: Timer -> Modal de
 * Criação de Flashcard -> Recompensa). Permite escolher um deck existente OU
 * criar um novo ali mesmo — sem isso, um usuário sem nenhum deck ficava
 * travado nesse passo.
 */
@Component({
  selector: 'pc-flashcard-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './flashcard-modal.component.html',
  styleUrl: './flashcard-modal.component.scss',
})
export class FlashcardModalComponent implements OnInit {
  @Input({ required: true }) decks: DeckOption[] = [];
  @Input() focusMinutes = 25;

  @Output() create = new EventEmitter<FlashcardDraft>();
  @Output() cancel = new EventEmitter<void>();

  readonly newDeckOption = NEW_DECK_OPTION;

  deckId = '';
  newDeckTitle = '';
  front = '';
  back = '';

  ngOnInit(): void {
    // Sem nenhum deck ainda, já abre direto no modo "criar deck novo".
    if (this.decks.length === 0) {
      this.deckId = NEW_DECK_OPTION;
    }
  }

  get isCreatingNewDeck(): boolean {
    return this.deckId === NEW_DECK_OPTION;
  }

  get isValid(): boolean {
    const deckChoiceValid = this.isCreatingNewDeck ? this.newDeckTitle.trim().length > 0 : this.deckId.length > 0;
    return deckChoiceValid && this.front.trim().length > 0 && this.back.trim().length > 0;
  }

  submit(): void {
    if (!this.isValid) return;
    this.create.emit({
      deckId: this.isCreatingNewDeck ? undefined : this.deckId,
      newDeckTitle: this.isCreatingNewDeck ? this.newDeckTitle.trim() : undefined,
      front: this.front.trim(),
      back: this.back.trim(),
    });
  }
}
