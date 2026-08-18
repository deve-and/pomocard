import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { DashboardComponent } from './dashboard/dashboard.component';
import { DeckDetailComponent } from './deck-detail/deck-detail.component';
import { LoginComponent } from './login/login.component';
import { ReviewComponent } from './review/review.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'review/:deckId', component: ReviewComponent, canActivate: [authGuard] },
  { path: 'decks/:deckId', component: DeckDetailComponent, canActivate: [authGuard] },
];
