/**
 * Registrar Accounts Database Service
 *
 * Service injectable Angular pour gérer les comptes registrars.
 * Wrapper autour de RegistrarAccountsQueries pour l'injection de dépendances.
 */

import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PgApiUtilService } from '~/app/utils/pg-api.util';
import { ErrorHandlerService } from '~/app/services/error-handler.service';
import {
  RegistrarAccountsQueries,
  DbRegistrarAccount,
  SaveRegistrarAccountData,
} from './db-query-services/pg/db-registrar-accounts.service';
import { ProviderName } from './registrar-providers';

// Re-export types for consumers
export { DbRegistrarAccount, SaveRegistrarAccountData };

@Injectable({
  providedIn: 'root',
})
export class DbRegistrarAccountsService {
  private queries: RegistrarAccountsQueries;

  constructor(
    private pgApiUtil: PgApiUtilService,
    private errorHandler: ErrorHandlerService
  ) {
    this.queries = new RegistrarAccountsQueries(
      this.pgApiUtil,
      this.handleError.bind(this)
    );
  }

  /**
   * Gestion des erreurs
   */
  private handleError(error: any): Observable<never> {
    this.errorHandler.handleError({
      error,
      message: 'Database error in registrar accounts',
      showToast: true,
    });
    throw error;
  }

  /**
   * Récupère tous les comptes registrars
   */
  getAccounts(): Observable<DbRegistrarAccount[]> {
    return this.queries.getAccounts();
  }

  /**
   * Récupère un compte par ID
   */
  getAccountById(accountId: string): Observable<DbRegistrarAccount | null> {
    return this.queries.getAccountById(accountId);
  }

  /**
   * Récupère les comptes d'un provider spécifique
   */
  getAccountsByProvider(providerName: ProviderName): Observable<DbRegistrarAccount[]> {
    return this.queries.getAccountsByProvider(providerName);
  }

  /**
   * Crée un nouveau compte registrar
   */
  createAccount(data: SaveRegistrarAccountData): Observable<DbRegistrarAccount> {
    return this.queries.createAccount(data);
  }

  /**
   * Met à jour un compte registrar
   */
  updateAccount(
    accountId: string,
    data: Partial<SaveRegistrarAccountData>
  ): Observable<DbRegistrarAccount> {
    return this.queries.updateAccount(accountId, data);
  }

  /**
   * Met à jour la date de dernière synchronisation
   */
  updateLastSyncAt(accountId: string): Observable<void> {
    return this.queries.updateLastSyncAt(accountId);
  }

  /**
   * Supprime un compte registrar
   */
  deleteAccount(accountId: string): Observable<boolean> {
    return this.queries.deleteAccount(accountId);
  }

  /**
   * Compte le nombre de comptes par provider
   */
  getAccountCountsByProvider(): Observable<Record<ProviderName, number>> {
    return this.queries.getAccountCountsByProvider();
  }
}
