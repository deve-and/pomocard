import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PomodoroRewardResponse {
  manaEarned: number;
  xpEarned: number;
  staminaMultiplier: number;
}

export interface SrsState {
  easinessFactor: number;
  repetitions: number;
  intervalDays: number;
}

export interface ReviewResponse {
  schedule: SrsState & { nextReviewAt: string };
  manaEarned: number;
  staminaMultiplier: number;
}

/**
 * Cliente HTTP para o Mana Service / SRS Service expostos pelo backend
 * (ver backend/src/app.js). Mantém o dashboard desacoplado dos cálculos de
 * economia — o Angular só envia o evento (tempo de foco, stamina do dia) e
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
    minutesFocusedTodayBeforeSession: number
  ): Observable<ReviewResponse> {
    return this.http.post<ReviewResponse>(`${environment.apiBaseUrl}/reviews`, {
      quality,
      currentState,
      focusMinutes,
      minutesFocusedTodayBeforeSession,
    });
  }
}
