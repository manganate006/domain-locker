/**
 * Registrar Import Service
 *
 * Service Angular pour orchestrer l'import de domaines depuis les registrars.
 * Utilise les providers (OVH, Hostinger) et le service de base de données
 * pour importer automatiquement les domaines.
 */

import { Injectable } from '@angular/core';
import { Observable, Subject, from, of } from 'rxjs';
import { catchError, map, mergeMap, tap, toArray } from 'rxjs/operators';

import {
  RegistrarProvider,
  ProviderCredentials,
  DomainInfo,
  ImportResult,
  ProviderName,
  getProvider,
  getAllProviders,
  getAllProviderConfigs,
  ProviderConfig,
} from './registrar-providers';
import DatabaseService from '~/app/services/database.service';
import { SaveDomainData } from '~/app/../types/Database';

/**
 * État de l'import en cours
 */
export interface ImportProgress {
  total: number;
  current: number;
  currentDomain: string;
  status: 'idle' | 'fetching' | 'importing' | 'done' | 'error';
  results: ImportResult[];
  error?: string;
}

/**
 * Compte registrar stocké en base
 */
export interface RegistrarAccount {
  id: string;
  provider_name: ProviderName;
  credentials: ProviderCredentials;
  created_at: Date;
  label?: string;
}

@Injectable({
  providedIn: 'root',
})
export class RegistrarImportService {
  /** Observable pour suivre la progression de l'import */
  private progressSubject = new Subject<ImportProgress>();
  public progress$ = this.progressSubject.asObservable();

  /** État actuel de l'import */
  private currentProgress: ImportProgress = {
    total: 0,
    current: 0,
    currentDomain: '',
    status: 'idle',
    results: [],
  };

  constructor(private databaseService: DatabaseService) {}

  /**
   * Récupère les configurations de tous les providers disponibles
   */
  getAvailableProviders(): ProviderConfig[] {
    return getAllProviderConfigs();
  }

  /**
   * Récupère un provider par son nom
   */
  getProvider(name: ProviderName): RegistrarProvider | undefined {
    return getProvider(name);
  }

  /**
   * Teste les credentials pour un provider
   */
  async testCredentials(providerName: ProviderName, credentials: ProviderCredentials): Promise<boolean> {
    const provider = getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" not found`);
    }
    return provider.validateCredentials(credentials);
  }

  /**
   * Récupère la liste des domaines depuis un provider
   */
  async fetchDomainList(providerName: ProviderName, credentials: ProviderCredentials): Promise<string[]> {
    const provider = getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" not found`);
    }
    return provider.getDomainList(credentials);
  }

  /**
   * Récupère les infos détaillées de tous les domaines depuis un provider
   */
  async fetchAllDomainsInfo(
    providerName: ProviderName,
    credentials: ProviderCredentials
  ): Promise<DomainInfo[]> {
    const provider = getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" not found`);
    }

    this.updateProgress({
      status: 'fetching',
      currentDomain: 'Fetching domain list...',
    });

    const domains = await provider.getAllDomainsInfo(credentials);

    this.updateProgress({
      total: domains.length,
      status: 'fetching',
      currentDomain: `Found ${domains.length} domains`,
    });

    return domains;
  }

  /**
   * Importe un domaine dans la base de données
   */
  private async importSingleDomain(
    domainInfo: DomainInfo,
    registrarName: string
  ): Promise<ImportResult> {
    try {
      // Vérifier si le domaine existe déjà via la liste des domaines
      const existingDomains = await this.databaseService.instance.listDomainNames().toPromise();
      const exists = existingDomains?.includes(domainInfo.domain_name.toLowerCase()) || false;

      if (exists) {
        return {
          domain: domainInfo.domain_name,
          success: false,
          error: 'Domain already exists',
          data: domainInfo,
        };
      }

      // Préparer les données pour l'insertion
      const saveData: SaveDomainData = {
        domain: {
          domain_name: domainInfo.domain_name,
          expiry_date: domainInfo.expiry_date || undefined,
          registration_date: domainInfo.registration_date || undefined,
          updated_date: new Date(),
          notes: `Imported from ${registrarName}`,
        },
        tags: [`imported-${registrarName.toLowerCase().replace(/[^a-z0-9]/g, '')}`],
        notifications: [],
        statuses: domainInfo.status ? [domainInfo.status] : [],
        ipAddresses: [],
        ssl: undefined,
        whois: undefined,
        dns: domainInfo.dns_servers
          ? {
              nsRecords: domainInfo.dns_servers,
            }
          : undefined,
        registrar: {
          name: registrarName,
          id: '',
          url: '',
          registryDomainId: '',
        },
        host: undefined,
        subdomains: [],
        links: [],
      };

      // Sauvegarder le domaine
      await this.databaseService.instance.saveDomain(saveData).toPromise();

      return {
        domain: domainInfo.domain_name,
        success: true,
        data: domainInfo,
      };
    } catch (error: any) {
      return {
        domain: domainInfo.domain_name,
        success: false,
        error: error.message || 'Unknown error',
        data: domainInfo,
      };
    }
  }

  /**
   * Importe une liste de domaines
   */
  async importDomains(
    domains: DomainInfo[],
    registrarName: string,
    selectedDomains?: string[]
  ): Promise<ImportResult[]> {
    // Filtrer les domaines si une sélection est fournie
    const domainsToImport = selectedDomains
      ? domains.filter((d) => selectedDomains.includes(d.domain_name))
      : domains;

    this.updateProgress({
      total: domainsToImport.length,
      current: 0,
      status: 'importing',
      results: [],
    });

    const results: ImportResult[] = [];

    for (let i = 0; i < domainsToImport.length; i++) {
      const domain = domainsToImport[i];

      this.updateProgress({
        current: i + 1,
        currentDomain: domain.domain_name,
      });

      const result = await this.importSingleDomain(domain, registrarName);
      results.push(result);

      this.updateProgress({
        results: [...results],
      });

      // Petite pause pour ne pas surcharger la DB
      if (i < domainsToImport.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.updateProgress({
      status: 'done',
      currentDomain: '',
    });

    return results;
  }

  /**
   * Import complet depuis un provider
   * Combine la récupération des infos et l'import
   */
  async importFromProvider(
    providerName: ProviderName,
    credentials: ProviderCredentials,
    selectedDomains?: string[]
  ): Promise<ImportResult[]> {
    try {
      this.resetProgress();
      this.updateProgress({ status: 'fetching' });

      // Récupérer tous les domaines
      const domains = await this.fetchAllDomainsInfo(providerName, credentials);

      // Importer les domaines
      const registrarName =
        getProvider(providerName)?.config.displayName || providerName.toUpperCase();
      return await this.importDomains(domains, registrarName, selectedDomains);
    } catch (error: any) {
      this.updateProgress({
        status: 'error',
        error: error.message || 'Import failed',
      });
      throw error;
    }
  }

  /**
   * Met à jour l'état de progression
   */
  private updateProgress(update: Partial<ImportProgress>): void {
    this.currentProgress = { ...this.currentProgress, ...update };
    this.progressSubject.next(this.currentProgress);
  }

  /**
   * Réinitialise l'état de progression
   */
  resetProgress(): void {
    this.currentProgress = {
      total: 0,
      current: 0,
      currentDomain: '',
      status: 'idle',
      results: [],
    };
    this.progressSubject.next(this.currentProgress);
  }

  /**
   * Récupère l'état actuel de la progression
   */
  getProgress(): ImportProgress {
    return { ...this.currentProgress };
  }
}
