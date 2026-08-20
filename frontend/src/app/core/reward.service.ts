import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PomodoroRewardResponse {
  goldEarned: number;
  xpEarned: number;
  manaMultiplier: number;
}

export interface SrsState {
  easinessFactor: number;
  repetitions: number;
  intervalDays: number;
}

export interface ReviewResponse {
  schedule: SrsState & { nextReviewAt: string };
  goldEarned: number;
  manaMultiplier: number;
  /** true quando o Gold foi zerado pelo cooldown de 24h da carta, não por ter errado. */
  goldBlockedByCooldown: boolean;
}

/**
 * Cliente HTTP para o Gold Service / SRS Service expostos pelo backend
 * (ver backend/src/app.js). Mantém o dashboard desacoplado dos cálculos de
 * economia — o Angular só envia o evento (tempo de foco, mana do dia) e
 * exibe a recompensa devolvida.
 */
@Injectable({ providedIn: 'root' })
export class RewardService {
  constructor(private readonly http: HttpClient) {}

  completePomodoroSession(
    focusMinutes: number,
    minutesFocusedTodayBeforeSession: number
  ): Observable<PomodoroRewardResponse> {
    return this.http.post<PomodoroRewardResponse>(`${environment.apiBaseUrl}/rewards/pomodoro-session`, {
      focusMinutes,
      minutesFocusedTodayBeforeSession,
    });
  }

  submitReview(
    quality: number,
    currentState: SrsState,
    focusMinutes: number,
    minutesFocusedTodayBeforeSession: number,
    lastGoldAwardedAt: string | null
  ): Observable<ReviewResponse> {
    return this.http.post<ReviewResponse>(`${environment.apiBaseUrl}/reviews`, {
      quality,
      currentState,
      focusMinutes,
      minutesFocusedTodayBeforeSession,
      lastGoldAwardedAt,
    });
  }
}
