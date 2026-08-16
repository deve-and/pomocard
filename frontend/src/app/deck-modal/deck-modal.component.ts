import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Modal simples de criação de deck — só o título, sem cosméticos por enquanto. */
@Component({
  selector: 'pc-deck-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deck-modal.component.html',
  styleUrl: './deck-modal.component.scss',
})
export class DeckModalComponent {
  @Output() create = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  readonly title = signal('');
  readonly isSubmitting = signal(false);

  get isValid(): boolean {
    return this.title().trim().length > 0;
  }

  submit(): void {
    if (!this.isValid || this.isSubmitting()) return;
    this.create.emit(this.title().trim());
  }
}
