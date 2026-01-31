/**
 * Registrar Import Page
 *
 * Page d'import de domaines depuis les APIs des registrars.
 * Permet de sélectionner un compte registrar, voir les domaines disponibles,
 * et les importer dans Domain Locker.
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PrimeNgModule } from '~/app/prime-ng.module';
import { ConfirmationService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ProgressBarModule } from 'primeng/progressbar';

import {
  RegistrarImportService,
  ImportProgress,
} from '~/app/services/registrar-import.service';
import {
  DomainInfo,
  ProviderConfig,
  ProviderCredentials,
  ProviderName,
} from '~/app/services/registrar-providers';
import {
  DbRegistrarAccountsService,
  DbRegistrarAccount,
} from '~/app/services/db-registrar-accounts.service';
import { GlobalMessageService } from '~/app/services/messaging.service';
import { ErrorHandlerService } from '~/app/services/error-handler.service';

interface SelectableDomain extends DomainInfo {
  selected: boolean;
}

@Component({
  standalone: true,
  selector: 'app-registrar-import',
  imports: [CommonModule, PrimeNgModule, ReactiveFormsModule, TableModule, ProgressBarModule],
  providers: [ConfirmationService],
  templateUrl: './registrar-import.page.html',
  styleUrls: ['./registrar-import.page.scss'],
})
export default class RegistrarImportComponent implements OnInit, OnDestroy {
  /** Étape actuelle du wizard */
  step = 1;

  /** Providers disponibles */
  availableProviders: ProviderConfig[] = [];

  /** Comptes registrar configurés */
  registrarAccounts: DbRegistrarAccount[] = [];

  /** Formulaire de sélection */
  selectionForm: FormGroup;

  /** Domaines récupérés du registrar */
  fetchedDomains: SelectableDomain[] = [];

  /** État de chargement */
  isLoading = false;
  isFetching = false;
  isImporting = false;

  /** Progression de l'import */
  importProgress: ImportProgress | null = null;

  /** Résultats finaux */
  importedDomains: string[] = [];
  failedDomains: { domain: string; error: string }[] = [];
  skippedDomains: string[] = [];

  /** Provider sélectionné */
  selectedProvider: ProviderConfig | null = null;
  selectedAccount: DbRegistrarAccount | null = null;

  /** Credentials manuels (si pas de compte enregistré) */
  manualCredentialsForm: FormGroup;
  useManualCredentials = false;

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private importService: RegistrarImportService,
    private accountsService: DbRegistrarAccountsService,
    private messageService: GlobalMessageService,
    private errorHandler: ErrorHandlerService,
    private confirmationService: ConfirmationService
  ) {
    this.selectionForm = this.fb.group({
      provider: ['', Validators.required],
      account: [''],
    });

    this.manualCredentialsForm = this.fb.group({});
  }

  ngOnInit(): void {
    this.loadProviders();
    this.loadAccounts();
    this.subscribeToProgress();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Charge les providers disponibles
   */
  private loadProviders(): void {
    this.availableProviders = this.importService.getAvailableProviders();
  }

  /**
   * Charge les comptes registrar enregistrés
   */
  private loadAccounts(): void {
    this.accountsService.getAccounts().pipe(takeUntil(this.destroy$)).subscribe({
      next: (accounts: DbRegistrarAccount[]) => {
        this.registrarAccounts = accounts;
      },
      error: (error: Error) => {
        this.errorHandler.handleError({
          error,
          message: 'Failed to load registrar accounts',
          showToast: true,
        });
      },
    });
  }

  /**
   * S'abonne à la progression de l'import
   */
  private subscribeToProgress(): void {
    this.importService.progress$.pipe(takeUntil(this.destroy$)).subscribe((progress) => {
      this.importProgress = progress;
    });
  }

  /**
   * Gère la sélection d'un provider
   */
  onProviderChange(providerName: string): void {
    this.selectedProvider =
      this.availableProviders.find((p) => p.name === providerName) || null;
    this.selectedAccount = null;
    this.useManualCredentials = false;

    // Réinitialiser le formulaire de credentials manuels
    if (this.selectedProvider) {
      this.buildManualCredentialsForm(this.selectedProvider);
    }

    // Trouver les comptes associés à ce provider
    const accountsForProvider = this.registrarAccounts.filter(
      (a) => a.provider_name === providerName
    );

    if (accountsForProvider.length === 0) {
      this.useManualCredentials = true;
    }
  }

  /**
   * Construit le formulaire de credentials manuels
   */
  private buildManualCredentialsForm(provider: ProviderConfig): void {
    const controls: Record<string, any> = {};

    for (const field of provider.credentialFields) {
      controls[field.key] = [
        '',
        field.required ? Validators.required : [],
      ];
    }

    this.manualCredentialsForm = this.fb.group(controls);
  }

  /**
   * Gère la sélection d'un compte
   */
  onAccountChange(accountId: string): void {
    this.selectedAccount =
      this.registrarAccounts.find((a) => a.id === accountId) || null;
    this.useManualCredentials = !this.selectedAccount;
  }

  /**
   * Récupère les comptes pour le provider sélectionné
   */
  getAccountsForSelectedProvider(): DbRegistrarAccount[] {
    if (!this.selectedProvider) return [];
    return this.registrarAccounts.filter(
      (a) => a.provider_name === this.selectedProvider?.name
    );
  }

  /**
   * Passe à l'étape de récupération des domaines
   */
  async fetchDomains(): Promise<void> {
    if (!this.selectedProvider) {
      this.messageService.showWarn('Error', 'Please select a provider');
      return;
    }

    const credentials = this.getCredentials();
    if (!credentials) {
      this.messageService.showWarn('Error', 'Please provide credentials');
      return;
    }

    this.isFetching = true;
    this.fetchedDomains = [];

    try {
      // Valider les credentials
      const isValid = await this.importService.testCredentials(
        this.selectedProvider.name as ProviderName,
        credentials
      );

      if (!isValid) {
        this.messageService.showError('Error', 'Invalid credentials. Please check and try again.');
        this.isFetching = false;
        return;
      }

      // Récupérer les domaines
      const domains = await this.importService.fetchAllDomainsInfo(
        this.selectedProvider.name as ProviderName,
        credentials
      );

      this.fetchedDomains = domains.map((d) => ({
        ...d,
        selected: true,
      }));

      if (this.fetchedDomains.length === 0) {
        this.messageService.showInfo('Info', 'No domains found in this account');
      } else {
        this.messageService.showSuccess(
          'Success',
          `Found ${this.fetchedDomains.length} domains`
        );
        this.step = 2;
      }
    } catch (error: any) {
      this.errorHandler.handleError({
        error,
        message: 'Failed to fetch domains',
        showToast: true,
      });
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Récupère les credentials (compte ou manuels)
   */
  private getCredentials(): ProviderCredentials | null {
    if (this.selectedAccount) {
      return this.selectedAccount.credentials;
    }

    if (this.useManualCredentials && this.manualCredentialsForm.valid) {
      return this.manualCredentialsForm.value;
    }

    return null;
  }

  /**
   * Sélectionne/désélectionne tous les domaines
   */
  toggleSelectAll(selected: boolean): void {
    this.fetchedDomains = this.fetchedDomains.map((d) => ({
      ...d,
      selected,
    }));
  }

  /**
   * Compte les domaines sélectionnés
   */
  get selectedCount(): number {
    return this.fetchedDomains.filter((d) => d.selected).length;
  }

  /**
   * Importe les domaines sélectionnés
   */
  async importSelectedDomains(): Promise<void> {
    const selectedDomains = this.fetchedDomains
      .filter((d) => d.selected)
      .map((d) => d.domain_name);

    if (selectedDomains.length === 0) {
      this.messageService.showWarn('Warning', 'Please select at least one domain to import');
      return;
    }

    this.isImporting = true;
    this.importedDomains = [];
    this.failedDomains = [];
    this.skippedDomains = [];
    this.step = 3;

    try {
      const credentials = this.getCredentials();
      if (!credentials || !this.selectedProvider) {
        throw new Error('Missing credentials or provider');
      }

      const results = await this.importService.importDomains(
        this.fetchedDomains.filter((d) => d.selected),
        this.selectedProvider.displayName,
        selectedDomains
      );

      // Trier les résultats
      for (const result of results) {
        if (result.success) {
          this.importedDomains.push(result.domain);
        } else if (result.error === 'Domain already exists') {
          this.skippedDomains.push(result.domain);
        } else {
          this.failedDomains.push({
            domain: result.domain,
            error: result.error || 'Unknown error',
          });
        }
      }

      this.step = 4;
      this.messageService.showSuccess(
        'Import Complete',
        `Imported: ${this.importedDomains.length}, Skipped: ${this.skippedDomains.length}, Failed: ${this.failedDomains.length}`
      );
    } catch (error: any) {
      this.errorHandler.handleError({
        error,
        message: 'Import failed',
        showToast: true,
      });
      this.step = 4;
    } finally {
      this.isImporting = false;
    }
  }

  /**
   * Retourne à l'étape précédente
   */
  previousStep(): void {
    if (this.step > 1) {
      this.step--;
    }
  }

  /**
   * Recommence l'import
   */
  startOver(): void {
    this.step = 1;
    this.fetchedDomains = [];
    this.importedDomains = [];
    this.failedDomains = [];
    this.skippedDomains = [];
    this.importProgress = null;
    this.importService.resetProgress();
  }

  /**
   * Va à la page d'accueil
   */
  goToHomePage(): void {
    this.router.navigate(['/']);
  }

  /**
   * Va à la page de configuration des comptes
   */
  goToAccountSettings(): void {
    this.router.navigate(['/settings/registrar-accounts']);
  }

  /**
   * Formate une date pour l'affichage
   */
  formatDate(date: Date | null | undefined): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  }

  /**
   * Calcule le nombre de jours avant expiration
   */
  getDaysUntilExpiry(date: Date | null | undefined): number | null {
    if (!date) return null;
    const now = new Date();
    const expiry = new Date(date);
    const diff = expiry.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Retourne la classe CSS pour les jours restants
   */
  getExpiryClass(days: number | null): string {
    if (days === null) return '';
    if (days < 0) return 'text-red-500';
    if (days < 30) return 'text-red-400';
    if (days < 90) return 'text-yellow-400';
    return 'text-green-400';
  }
}
