/**
 * Registrar Accounts Database Queries
 *
 * Service pour gérer les comptes registrars en base de données.
 * Stocke les credentials API pour les providers (OVH, Hostinger, etc.)
 */

import { catchError, from, map, Observable, of } from 'rxjs';
import { PgApiUtilService } from '~/app/utils/pg-api.util';
import { ProviderName, ProviderCredentials } from '../../registrar-providers';

/**
 * Compte registrar stocké en base
 */
export interface DbRegistrarAccount {
  id: string;
  user_id: string;
  provider_name: ProviderName;
  label: string | null;
  credentials: ProviderCredentials;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

/**
 * Données pour créer/mettre à jour un compte registrar
 */
export interface SaveRegistrarAccountData {
  provider_name: ProviderName;
  label?: string;
  credentials: ProviderCredentials;
}

/**
 * Service de requêtes pour les comptes registrars
 */
export class RegistrarAccountsQueries {
  private readonly userId = 'a0000000-aaaa-42a0-a0a0-00a000000a69';

  constructor(
    private pgApiUtil: PgApiUtilService,
    private handleError: (error: any) => Observable<never>
  ) {}

  /**
   * Récupère tous les comptes registrars de l'utilisateur
   */
  getAccounts(): Observable<DbRegistrarAccount[]> {
    const query = `
      SELECT id, user_id, provider_name, label, credentials,
             created_at, updated_at, last_sync_at
      FROM registrar_accounts
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    return from(this.pgApiUtil.postToPgExecutor<DbRegistrarAccount>(query, [this.userId])).pipe(
      map((response) => response.data),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Récupère un compte registrar par son ID
   */
  getAccountById(accountId: string): Observable<DbRegistrarAccount | null> {
    const query = `
      SELECT id, user_id, provider_name, label, credentials,
             created_at, updated_at, last_sync_at
      FROM registrar_accounts
      WHERE id = $1 AND user_id = $2
    `;

    return from(this.pgApiUtil.postToPgExecutor<DbRegistrarAccount>(query, [accountId, this.userId])).pipe(
      map((response) => response.data[0] || null),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Récupère les comptes d'un provider spécifique
   */
  getAccountsByProvider(providerName: ProviderName): Observable<DbRegistrarAccount[]> {
    const query = `
      SELECT id, user_id, provider_name, label, credentials,
             created_at, updated_at, last_sync_at
      FROM registrar_accounts
      WHERE user_id = $1 AND provider_name = $2
      ORDER BY created_at DESC
    `;

    return from(
      this.pgApiUtil.postToPgExecutor<DbRegistrarAccount>(query, [this.userId, providerName])
    ).pipe(
      map((response) => response.data),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Crée un nouveau compte registrar
   */
  createAccount(data: SaveRegistrarAccountData): Observable<DbRegistrarAccount> {
    const query = `
      INSERT INTO registrar_accounts (user_id, provider_name, label, credentials)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, provider_name, label, credentials,
                created_at, updated_at, last_sync_at
    `;

    const params = [
      this.userId,
      data.provider_name,
      data.label || null,
      JSON.stringify(data.credentials),
    ];

    return from(this.pgApiUtil.postToPgExecutor<DbRegistrarAccount>(query, params)).pipe(
      map((response) => {
        if (!response.data[0]) {
          throw new Error('Failed to create registrar account');
        }
        return response.data[0];
      }),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Met à jour un compte registrar
   */
  updateAccount(accountId: string, data: Partial<SaveRegistrarAccountData>): Observable<DbRegistrarAccount> {
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.label !== undefined) {
      updates.push(`label = $${paramIndex++}`);
      params.push(data.label);
    }

    if (data.credentials !== undefined) {
      updates.push(`credentials = $${paramIndex++}`);
      params.push(JSON.stringify(data.credentials));
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    params.push(accountId);
    params.push(this.userId);

    const query = `
      UPDATE registrar_accounts
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
      RETURNING id, user_id, provider_name, label, credentials,
                created_at, updated_at, last_sync_at
    `;

    return from(this.pgApiUtil.postToPgExecutor<DbRegistrarAccount>(query, params)).pipe(
      map((response) => {
        if (!response.data[0]) {
          throw new Error('Failed to update registrar account');
        }
        return response.data[0];
      }),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Met à jour la date de dernière synchronisation
   */
  updateLastSyncAt(accountId: string): Observable<void> {
    const query = `
      UPDATE registrar_accounts
      SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `;

    return from(this.pgApiUtil.postToPgExecutor(query, [accountId, this.userId])).pipe(
      map(() => undefined),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Supprime un compte registrar
   */
  deleteAccount(accountId: string): Observable<boolean> {
    const query = `
      DELETE FROM registrar_accounts
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `;

    return from(this.pgApiUtil.postToPgExecutor<{ id: string }>(query, [accountId, this.userId])).pipe(
      map((response) => response.data.length > 0),
      catchError((error) => this.handleError(error))
    );
  }

  /**
   * Compte le nombre de comptes par provider
   */
  getAccountCountsByProvider(): Observable<Record<ProviderName, number>> {
    const query = `
      SELECT provider_name, COUNT(*) as count
      FROM registrar_accounts
      WHERE user_id = $1
      GROUP BY provider_name
    `;

    return from(
      this.pgApiUtil.postToPgExecutor<{ provider_name: ProviderName; count: number }>(query, [
        this.userId,
      ])
    ).pipe(
      map((response) => {
        const counts: Record<string, number> = {};
        response.data.forEach((item) => {
          counts[item.provider_name] = Number(item.count);
        });
        return counts as Record<ProviderName, number>;
      }),
      catchError((error) => this.handleError(error))
    );
  }
}
