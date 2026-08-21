import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { PomodoroTimerService } from '../core/pomodoro-timer.service';

const SPRITE_SIZE = 32;
const STEP_INTERVAL_MS = 350;

/**
 * Ato I do loop de 3 atos ("A Jornada de Exploração" — ver o comentário de
 * isZenModeActive em pomodoro-timer.service.ts): tela cheia, sem distrações,
 * só o cronômetro e um herói de pixel art andando — nenhuma interação além
 * de Pausar. Renderizada na raiz do app (ver app.component.ts) pra cobrir a
 * tela inteira independente da rota em que o usuário estiver quando o foco
 * começar.
 */
@Component({
  selector: 'pc-focus-mode',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './focus-mode.component.html',
  styleUrl: './focus-mode.component.scss',
})
export class FocusModeComponent implements AfterViewInit, OnDestroy {
  readonly timer = inject(PomodoroTimerService);

  @ViewChild('heroCanvas') private readonly heroCanvasRef!: ElementRef<HTMLCanvasElement>;
  private stepIntervalHandle?: ReturnType<typeof setInterval>;
  private stepFrame = 0;

  get displayTime(): string {
    return this.timer.displayTime;
  }

  ngAfterViewInit(): void {
    const ctx = this.heroCanvasRef.nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    this.drawHero(ctx, this.stepFrame);
    this.stepIntervalHandle = setInterval(() => {
      this.stepFrame = (this.stepFrame + 1) % 2;
      this.drawHero(ctx, this.stepFrame);
    }, STEP_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.stepIntervalHandle);
  }

  pause(): void {
    this.timer.pause();
  }

  /**
   * Herói minimalista em blocos (sem assets externos, mesma técnica dos
   * outros elementos de pixel art do app): túnica azul, cabeça, cajado, e
   * duas posições de perna alternadas simulando passos.
   */
  private drawHero(ctx: CanvasRenderingContext2D, frame: number): void {
    ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);

    ctx.fillStyle = '#fde047';
    ctx.fillRect(11, 4, 10, 8);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(13, 8, 2, 2);
    ctx.fillRect(18, 8, 2, 2);

    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(9, 12, 14, 13);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(22, 10, 2, 10);
    ctx.fillRect(21, 15, 4, 2);

    ctx.fillStyle = '#1e293b';
    if (frame === 0) {
      ctx.fillRect(10, 25, 4, 7);
      ctx.fillRect(17, 25, 4, 5);
    } else {
      ctx.fillRect(10, 25, 4, 5);
      ctx.fillRect(17, 25, 4, 7);
    }
  }
}
