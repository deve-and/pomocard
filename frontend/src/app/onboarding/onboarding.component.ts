import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, signal } from '@angular/core';

interface OnboardingSlide {
  icon: string;
  title: string;
  subtitle: string;
}

/**
 * Carrossel de 3 telas mostrado só na primeira visita ao dashboard (ver
 * ONBOARDING_STORAGE_KEY em dashboard.component.ts) — traduz o jargão de
 * RPG (Mana, Gold, Escudo de Ofensiva) pro que ele realmente significa,
 * antes do usuário esbarrar nesses termos sem contexto. Copy e estrutura
 * (Título curto + subtítulo + CTA por tela) seguem o próprio padrão que o
 * guia de UX Writing do usuário sugeriu pra onboarding orientado à ação.
 */
const SLIDES: OnboardingSlide[] = [
  {
    icon: '🧘',
    title: 'Foco Sem Distrações',
    subtitle: '25 minutos, um herói andando, zero distrações até o alarme tocar.',
  },
  {
    icon: '⚔️',
    title: 'Batalhas de Memória',
    subtitle: 'Cada flashcard é um monstro — responda certo pra vencer e evoluir.',
  },
  {
    icon: '📈',
    title: 'Evolução Diária',
    subtitle: 'Gold, XP e uma sequência protegida por Escudos — não perca o ritmo.',
  },
];

@Component({
  selector: 'pc-onboarding',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent {
  @Output() closed = new EventEmitter<void>();

  readonly slides = SLIDES;
  readonly currentIndex = signal(0);

  readonly isLastSlide = () => this.currentIndex() === this.slides.length - 1;

  next(): void {
    if (this.isLastSlide()) {
      this.closed.emit();
      return;
    }
    this.currentIndex.update((i) => i + 1);
  }

  goTo(index: number): void {
    this.currentIndex.set(index);
  }

  skip(): void {
    this.closed.emit();
  }
}
