/**
 * Registrar Providers Registry
 *
 * Point d'entrée centralisé pour tous les providers de registrars.
 * 18 registrars supportés, basé sur les patterns de DomainMOD.
 */

import {
  RegistrarProvider,
  ProviderConfig,
  ProviderName,
} from './provider.interface';

// Import de tous les providers
import { ovhProvider } from './ovh.provider';
import { hostingerProvider } from './hostinger.provider';
import { godaddyProvider } from './godaddy.provider';
import { cloudflareProvider } from './cloudflare.provider';
import { namecheapProvider } from './namecheap.provider';
import { porkbunProvider } from './porkbun.provider';
import { gandiProvider } from './gandi.provider';
import { namesiloProvider } from './namesilo.provider';
import { dynadotProvider } from './dynadot.provider';
import { namecomProvider } from './namecom.provider';
import { dreamhostProvider } from './dreamhost.provider';
import { enomProvider } from './enom.provider';
import { internetbsProvider } from './internetbs.provider';
import { namebrightProvider } from './namebright.provider';
import { opensrsProvider } from './opensrs.provider';
import { resellerclubProvider } from './resellerclub.provider';
import { dnsimpleProvider } from './dnsimple.provider';
import { abovecomProvider } from './abovecom.provider';

// Re-export des interfaces et types
export * from './provider.interface';

/**
 * Registry de tous les providers disponibles
 */
const providers: Map<ProviderName, RegistrarProvider> = new Map([
  ['ovh', ovhProvider],
  ['hostinger', hostingerProvider],
  ['godaddy', godaddyProvider],
  ['cloudflare', cloudflareProvider],
  ['namecheap', namecheapProvider],
  ['porkbun', porkbunProvider],
  ['gandi', gandiProvider],
  ['namesilo', namesiloProvider],
  ['dynadot', dynadotProvider],
  ['namecom', namecomProvider],
  ['dreamhost', dreamhostProvider],
  ['enom', enomProvider],
  ['internetbs', internetbsProvider],
  ['namebright', namebrightProvider],
  ['opensrs', opensrsProvider],
  ['resellerclub', resellerclubProvider],
  ['dnsimple', dnsimpleProvider],
  ['abovecom', abovecomProvider],
]);

/**
 * Récupère un provider par son nom
 * @param name Nom du provider
 * @returns Le provider ou undefined si non trouvé
 */
export function getProvider(name: ProviderName): RegistrarProvider | undefined {
  return providers.get(name);
}

/**
 * Récupère tous les providers disponibles
 * @returns Array de tous les providers
 */
export function getAllProviders(): RegistrarProvider[] {
  return Array.from(providers.values());
}

/**
 * Récupère les configurations de tous les providers (pour l'UI)
 * @returns Array des configurations
 */
export function getAllProviderConfigs(): ProviderConfig[] {
  return getAllProviders().map((p) => p.config);
}

/**
 * Vérifie si un provider existe
 * @param name Nom du provider
 * @returns true si le provider existe
 */
export function hasProvider(name: string): name is ProviderName {
  return providers.has(name as ProviderName);
}

/**
 * Liste des noms de providers disponibles
 */
export function getProviderNames(): ProviderName[] {
  return Array.from(providers.keys());
}

/**
 * Nombre de providers disponibles
 */
export function getProviderCount(): number {
  return providers.size;
}

// Export des providers individuels pour usage direct
export { ovhProvider } from './ovh.provider';
export { hostingerProvider } from './hostinger.provider';
export { godaddyProvider } from './godaddy.provider';
export { cloudflareProvider } from './cloudflare.provider';
export { namecheapProvider } from './namecheap.provider';
export { porkbunProvider } from './porkbun.provider';
export { gandiProvider } from './gandi.provider';
export { namesiloProvider } from './namesilo.provider';
export { dynadotProvider } from './dynadot.provider';
export { namecomProvider } from './namecom.provider';
export { dreamhostProvider } from './dreamhost.provider';
export { enomProvider } from './enom.provider';
export { internetbsProvider } from './internetbs.provider';
export { namebrightProvider } from './namebright.provider';
export { opensrsProvider } from './opensrs.provider';
export { resellerclubProvider } from './resellerclub.provider';
export { dnsimpleProvider } from './dnsimple.provider';
export { abovecomProvider } from './abovecom.provider';
