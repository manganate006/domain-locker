import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService, ConfirmationService } from 'primeng/api';
import { PrimeNgModule } from '~/app/prime-ng.module';
import DatabaseService from '~/app/services/database.service';
import { RegistrarImportService } from '~/app/services/registrar-import.service';
import {
  ProviderConfig,
  ProviderCredentials,
  ProviderName,
  getAllProviderConfigs,
} from '~/app/services/registrar-providers';
import {
  DbRegistrarAccount,
  SaveRegistrarAccountData,
} from '~/app/services/db-query-services/pg/db-registrar-accounts.service';
import { GlobalMessageService } from '~/app/services/messaging.service';
import { ErrorHandlerService } from '~/app/services/error-handler.service';

@Component({
  standalone: true,
  selector: 'app-registrar-accounts',
  templateUrl: './registrar-accounts.page.html',
  styleUrls: ['./index.page.scss'],
  imports: [CommonModule, PrimeNgModule, ReactiveFormsModule],
  providers: [MessageService, ConfirmationService],
})
export default class RegistrarAccountsPage implements OnInit {
  // Available providers
  providers: ProviderConfig[] = [];

  // Accounts from database
  accounts: DbRegistrarAccount[] = [];

  // Form for adding/editing accounts
  accountForm!: FormGroup;
  selectedProvider: ProviderConfig | null = null;

  // UI state
  loading = {
    accounts: false,
    save: false,
    test: false,
    delete: false,
  };

  showAddDialog = false;
  editingAccountId: string | null = null;
  testResult: { success: boolean; message: string } | null = null;

  constructor(
    private fb: FormBuilder,
    private databaseService: DatabaseService,
    private importService: RegistrarImportService,
    private messageService: GlobalMessageService,
    private errorHandler: ErrorHandlerService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.providers = getAllProviderConfigs();
    this.loadAccounts();
    this.initForm();
  }

  private initForm(): void {
    this.accountForm = this.fb.group({
      provider_name: ['', Validators.required],
      label: [''],
      credentials: this.fb.group({}),
    });
  }

  private loadAccounts(): void {
    this.loading.accounts = true;
    this.databaseService.instance.registrarAccountsQueries.getAccounts().subscribe({
      next: (accounts: DbRegistrarAccount[]) => {
        this.accounts = accounts;
        this.loading.accounts = false;
      },
      error: (error: Error) => {
        this.errorHandler.handleError({
          error,
          message: 'Failed to load registrar accounts',
          location: 'registrar-accounts.page',
          showToast: true,
        });
        this.loading.accounts = false;
      },
    });
  }

  onProviderChange(providerName: string): void {
    this.selectedProvider = this.providers.find((p) => p.name === providerName) || null;
    this.testResult = null;

    if (this.selectedProvider) {
      // Build credentials form group dynamically
      const credentialsGroup: { [key: string]: any } = {};
      this.selectedProvider.credentialFields.forEach((field) => {
        credentialsGroup[field.key] = [
          '',
          field.required ? Validators.required : [],
        ];
      });
      this.accountForm.setControl('credentials', this.fb.group(credentialsGroup));
    }
  }

  openAddDialog(): void {
    this.editingAccountId = null;
    this.selectedProvider = null;
    this.testResult = null;
    this.initForm();
    this.showAddDialog = true;
  }

  openEditDialog(account: DbRegistrarAccount): void {
    this.editingAccountId = account.id;
    this.selectedProvider =
      this.providers.find((p) => p.name === account.provider_name) || null;
    this.testResult = null;

    this.accountForm.patchValue({
      provider_name: account.provider_name,
      label: account.label || '',
    });

    if (this.selectedProvider) {
      const credentialsGroup: { [key: string]: any } = {};
      this.selectedProvider.credentialFields.forEach((field) => {
        credentialsGroup[field.key] = [
          account.credentials[field.key] || '',
          field.required ? Validators.required : [],
        ];
      });
      this.accountForm.setControl('credentials', this.fb.group(credentialsGroup));
    }

    this.showAddDialog = true;
  }

  closeDialog(): void {
    this.showAddDialog = false;
    this.editingAccountId = null;
    this.selectedProvider = null;
    this.testResult = null;
  }

  async testCredentials(): Promise<void> {
    if (!this.selectedProvider) return;

    this.loading.test = true;
    this.testResult = null;

    try {
      const credentials = this.accountForm.get('credentials')?.value as ProviderCredentials;
      const isValid = await this.importService.testCredentials(
        this.selectedProvider.name as ProviderName,
        credentials
      );

      this.testResult = {
        success: isValid,
        message: isValid
          ? 'Connection successful! Credentials are valid.'
          : 'Connection failed. Please check your credentials.',
      };
    } catch (error: any) {
      this.testResult = {
        success: false,
        message: error.message || 'Connection test failed',
      };
    } finally {
      this.loading.test = false;
    }
  }

  async saveAccount(): Promise<void> {
    if (this.accountForm.invalid || !this.selectedProvider) return;

    this.loading.save = true;

    const data: SaveRegistrarAccountData = {
      provider_name: this.accountForm.get('provider_name')?.value,
      label: this.accountForm.get('label')?.value || undefined,
      credentials: this.accountForm.get('credentials')?.value,
    };

    try {
      if (this.editingAccountId) {
        // Update existing
        await this.databaseService.instance.registrarAccountsQueries
          .updateAccount(this.editingAccountId, data)
          .toPromise();
        this.messageService.showSuccess('Success', 'Account updated successfully');
      } else {
        // Create new
        await this.databaseService.instance.registrarAccountsQueries
          .createAccount(data)
          .toPromise();
        this.messageService.showSuccess('Success', 'Account created successfully');
      }

      this.closeDialog();
      this.loadAccounts();
    } catch (error: any) {
      this.errorHandler.handleError({
        error,
        message: 'Failed to save account',
        location: 'registrar-accounts.page',
        showToast: true,
      });
    } finally {
      this.loading.save = false;
    }
  }

  confirmDelete(account: DbRegistrarAccount): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the ${account.provider_name.toUpperCase()} account "${account.label || account.id}"?`,
      header: 'Delete Registrar Account',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.deleteAccount(account.id),
    });
  }

  private async deleteAccount(accountId: string): Promise<void> {
    this.loading.delete = true;

    try {
      await this.databaseService.instance.registrarAccountsQueries
        .deleteAccount(accountId)
        .toPromise();
      this.messageService.showSuccess('Success', 'Account deleted successfully');
      this.loadAccounts();
    } catch (error: any) {
      this.errorHandler.handleError({
        error,
        message: 'Failed to delete account',
        location: 'registrar-accounts.page',
        showToast: true,
      });
    } finally {
      this.loading.delete = false;
    }
  }

  getProviderDisplayName(providerName: string): string {
    const provider = this.providers.find((p) => p.name === providerName);
    return provider?.displayName || providerName.toUpperCase();
  }

  getProviderIcon(providerName: string): string {
    // Return appropriate icon based on provider
    switch (providerName) {
      case 'ovh':
        return 'pi pi-cloud';
      case 'hostinger':
        return 'pi pi-server';
      default:
        return 'pi pi-globe';
    }
  }

  formatDate(date: string | null): string {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
