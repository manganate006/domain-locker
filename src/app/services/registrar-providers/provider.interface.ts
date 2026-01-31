/**
 * Registrar Provider Interface
 *
 * Interface commune pour tous les providers de registrars (OVH, Hostinger, etc.)
 * Permet l'import automatique des domaines via les APIs des registrars.
 */

/**
 * Credentials pour l'authentification auprès d'un registrar
 */
export interface ProviderCredentials {
  [key: string]: string | undefined;
}

/**
 * Types d'endpoints OVH supportés
 */
export type OvhEndpoint = 'ovh-eu' | 'ovh-ca' | 'ovh-us' | 'kimsufi-eu' | 'kimsufi-ca' | 'soyoustart-eu' | 'soyoustart-ca';

/**
 * Credentials spécifiques pour OVH (signature HMAC)
 */
export interface OvhCredentials extends ProviderCredentials {
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  endpoint?: OvhEndpoint;
}

/**
 * Credentials spécifiques pour Hostinger (Bearer Token)
 */
export interface HostingerCredentials extends ProviderCredentials {
  apiKey: string;
}

/**
 * Informations d'un domaine retournées par un provider
 */
export interface DomainInfo {
  domain_name: string;
  expiry_date: Date | null;
  registration_date?: Date | null;
  dns_servers?: string[];
  auto_renew?: boolean;
  status?: string;
  registrar_name?: string;
}

/**
 * Résultat de l'import d'un domaine
 */
export interface ImportResult {
  domain: string;
  success: boolean;
  error?: string;
  data?: DomainInfo;
}

/**
 * Configuration d'un provider
 */
export interface ProviderConfig {
  name: string;
  displayName: string;
  description: string;
  credentialFields: CredentialField[];
  docsUrl?: string;
}

/**
 * Définition d'un champ de credential pour l'UI
 */
export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'email';
  placeholder?: string;
  helpText?: string;
  required: boolean;
}

/**
 * Interface que tous les providers doivent implémenter
 */
export interface RegistrarProvider {
  /** Identifiant unique du provider */
  readonly name: string;

  /** Configuration du provider pour l'UI */
  readonly config: ProviderConfig;

  /**
   * Vérifie si les credentials sont valides
   * @param credentials Credentials à vérifier
   * @returns true si les credentials sont valides
   */
  validateCredentials(credentials: ProviderCredentials): Promise<boolean>;

  /**
   * Récupère la liste des domaines
   * @param credentials Credentials d'authentification
   * @returns Liste des noms de domaines
   */
  getDomainList(credentials: ProviderCredentials): Promise<string[]>;

  /**
   * Récupère les informations détaillées d'un domaine
   * @param credentials Credentials d'authentification
   * @param domain Nom du domaine
   * @returns Informations du domaine
   */
  getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo>;

  /**
   * Récupère les informations de tous les domaines
   * @param credentials Credentials d'authentification
   * @returns Liste des informations de tous les domaines
   */
  getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]>;
}

/**
 * Noms des providers supportés
 */
export type ProviderName =
  | 'ovh'
  | 'hostinger'
  | 'godaddy'
  | 'cloudflare'
  | 'namecheap'
  | 'porkbun'
  | 'gandi'
  | 'namesilo'
  | 'dynadot'
  | 'namecom'
  | 'dreamhost'
  | 'enom'
  | 'internetbs'
  | 'namebright'
  | 'opensrs'
  | 'resellerclub'
  | 'dnsimple'
  | 'abovecom';
