import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Modal de confirmação genérico — usado para ações destrutivas (excluir deck/flashcard). */
@Component({
  selector: 'pc-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  @Input({ required: true }) title = '';
  @Input({ required: true }) message = '';
  @Input() confirmLabel = 'Excluir';

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
}
