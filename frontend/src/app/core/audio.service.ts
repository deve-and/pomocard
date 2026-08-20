import { Injectable } from '@angular/core';

/**
 * Efeitos sonoros sintetizados via Web Audio API — sem depender de arquivos
 * de áudio externos. Ondas quadradas/triangulares curtas remetem ao som de
 * consoles 8-bit, coerente com a estética pixel art do resto do app.
 */
/** Quantas vezes o alerta de "timer concluído" repete antes de desistir sozinho. */
const ALERT_MAX_REPEATS = 3;
/** Janela reservada pra cada toque do alerta (o jingle em si dura bem menos que isso). */
const ALERT_PLAY_WINDOW_MS = 1500;
/** Silêncio entre um toque do alerta e o próximo. */
const ALERT_PAUSE_MS = 1000;

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audioContext?: AudioContext;
  private alertTimeoutHandle?: ReturnType<typeof setTimeout>;

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  /**
   * Navegadores só liberam áudio depois de um gesto do usuário. Chame isto
   * de dentro de um (click) — ex.: o botão "Iniciar" do timer — para
   * destravar o contexto e permitir que os sons toquem sozinhos depois,
   * quando o timer chegar a zero sem nenhuma interação direta.
   */
  unlock(): void {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  private playTone(frequency: number, startOffset: number, duration: number, type: OscillatorType, volume: number): void {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') ctx.resume();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const startTime = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }

  /** Arpejo ascendente estilo "missão concluída" — toca ao fim de um foco. */
  playFocusComplete(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => this.playTone(freq, i * 0.09, 0.16, 'square', 0.14));
  }

  /** Sino curto e suave — toca ao fim de um descanso, chamando de volta ao foco. */
  playBreakComplete(): void {
    this.playTone(783.99, 0, 0.14, 'triangle', 0.12); // G5
    this.playTone(523.25, 0.13, 0.22, 'triangle', 0.12); // C5
  }

  /**
   * Toca `playOnce` em loop controlado (até ALERT_MAX_REPEATS vezes, com uma pausa
   * entre cada toque) em vez de uma única vez — o timer chegando a zero é o tipo de
   * evento que precisa continuar chamando atenção mesmo se o usuário não estiver
   * olhando pra tela na hora exata. Cancela qualquer loop de alerta já em andamento
   * antes de começar um novo, então nunca sobrepõe dois alertas ao mesmo tempo.
   */
  playRepeatingAlert(playOnce: () => void, repeatsRemaining = ALERT_MAX_REPEATS): void {
    this.stopRepeatingAlert();
    if (repeatsRemaining <= 0) return;

    playOnce();
    this.alertTimeoutHandle = setTimeout(() => {
      this.alertTimeoutHandle = setTimeout(() => this.playRepeatingAlert(playOnce, repeatsRemaining - 1), ALERT_PAUSE_MS);
    }, ALERT_PLAY_WINDOW_MS);
  }

  /** Interrompe o loop de alerta na hora — chamado assim que o usuário interage com o timer de novo. */
  stopRepeatingAlert(): void {
    clearTimeout(this.alertTimeoutHandle);
    this.alertTimeoutHandle = undefined;
  }
}
