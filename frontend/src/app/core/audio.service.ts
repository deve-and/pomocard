import { Injectable } from '@angular/core';

/**
 * Efeitos sonoros sintetizados via Web Audio API — sem depender de arquivos
 * de áudio externos. Ondas quadradas/triangulares curtas remetem ao som de
 * consoles 8-bit, coerente com a estética pixel art do resto do app.
 */
/** Quantas vezes o alerta de "timer concluído" repete antes de desistir sozinho. */
const ALERT_MAX_REPEATS = 3;
/** Janela reservada pra cada toque do alerta — cadência ágil e compacta, não bipes espaçados. */
const ALERT_PLAY_WINDOW_MS = 300;
/** Silêncio entre um toque do alerta e o próximo. */
const ALERT_PAUSE_MS = 200;

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

  /** 3 bipes rápidos em escala ascendente — estilo "Level Up" / Missão Concluída, triunfante e curto. */
  playFocusComplete(): void {
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => this.playTone(freq, i * 0.08, 0.14, 'square', 0.14));
  }

  /**
   * 2 bipes rítmicos na MESMA nota — estilo "início de turno" / alarme de batalha,
   * um chamado de volta ao foco, não uma melodia (por isso não varia a nota).
   */
  playBreakComplete(): void {
    const CALL_NOTE = 659.25; // E5
    this.playTone(CALL_NOTE, 0, 0.18, 'square', 0.13);
    this.playTone(CALL_NOTE, 0.24, 0.18, 'square', 0.13);
  }

  /**
   * Rugido curto em glissando (grave → agudo, dente-de-serra) — dispara ao entrar
   * numa fila de revisão com cartas pendentes, o equivalente sonoro de "monstros
   * emergiram da escuridão do esquecimento". Só toca uma vez, sem repetição.
   */
  playEncounter(): void {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') ctx.resume();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sawtooth';

    const startTime = ctx.currentTime;
    const duration = 0.3;
    oscillator.frequency.setValueAtTime(140, startTime);
    oscillator.frequency.linearRampToValueAtTime(520, startTime + duration);
    gain.gain.setValueAtTime(0.16, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration + 0.05);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
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
