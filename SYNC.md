# Synchronisation avec le projet upstream

Ce fork de [Lissy93/domain-locker](https://github.com/Lissy93/domain-locker) contient des modifications personnalisées pour l'import automatique de domaines depuis les APIs des registrars.

## Structure des branches

| Branche | Rôle |
|---------|------|
| `main` | Miroir de upstream (Lissy93/domain-locker) |
| `feature/registrar-import` | Modifications personnalisées (providers, fix settings, etc.) |

## Remotes configurés

```bash
git remote -v
# origin    git@github.com:manganate006/domain-locker.git (fetch/push)
# upstream  https://github.com/Lissy93/domain-locker.git (fetch/push)
```

## Synchroniser avec upstream

### 1. Récupérer les mises à jour upstream

```bash
# Récupérer les commits de Lissy93/domain-locker
git fetch upstream
```

### 2. Mettre à jour la branche main

```bash
git checkout main
git merge upstream/main
git push origin main
```

### 3. Rebaser la branche feature sur main

```bash
git checkout feature/registrar-import
git rebase main
```

### 4. Résoudre les conflits (si nécessaire)

En cas de conflit pendant le rebase :

```bash
# Voir les fichiers en conflit
git status

# Éditer les fichiers pour résoudre les conflits
# Puis marquer comme résolu
git add <fichier>

# Continuer le rebase
git rebase --continue

# Ou annuler si trop complexe
git rebase --abort
```

### 5. Pousser la branche feature (force push après rebase)

```bash
git push origin feature/registrar-import --force-with-lease
```

## Commande complète (one-liner)

```bash
git fetch upstream && \
git checkout main && \
git merge upstream/main && \
git push origin main && \
git checkout feature/registrar-import && \
git rebase main && \
git push origin feature/registrar-import --force-with-lease
```

## Rebuild Docker après synchronisation

```bash
docker compose down
docker compose build --no-cache app
docker compose up -d
```

## Modifications apportées dans ce fork

### Fichiers modifiés

- `db/schema.sql` — Tables `registrar_accounts` et `autofetch_settings` ajoutées, colonne `auto_sync`
- `docker-compose.yml` — Service `updater` (cron), variable `DL_AUTOFETCH_KEY`
- `src/app/constants/feature-options.ts` — Domain Monitor activé en mode self-hosted
- `src/app/pages/settings/index.page.html` — Fix pour autoriser les pages settings en mode PostgreSQL
- `src/app/pages/settings/registrar-accounts.page.ts` — Toggle auto_sync + gestion clé API autofetch
- `src/app/pages/settings/registrar-accounts.page.html` — UI autofetch (toggle, clé API, commande cron)
- `src/app/services/db-query-services/pg/db-registrar-accounts.service.ts` — Support auto_sync + gestion clé API
- `src/app/services/registrar-providers/*.provider.ts` — 18 providers migrés vers le proxy backend

### Fichiers ajoutés

- `src/server/routes/registrar-proxy.ts` — Route proxy backend pour les appels API registrars (contourne CORS)
- `src/server/routes/registrar-autofetch.ts` — Endpoint autofetch pour synchronisation automatique via cron
- `src/app/services/registrar-providers/` — Providers pour 18 registrars (OVH, Hostinger, GoDaddy, Cloudflare, etc.)
- `src/app/pages/domains/add/registrar-import/` — Page d'import depuis registrar
- `src/app/pages/settings/registrar-accounts.page.ts` — Page de configuration des comptes registrar

## Notes importantes

- **Ne jamais merger** `feature/registrar-import` dans `main` pour garder la synchronisation simple
- **Toujours rebaser** la branche feature sur main (pas merge) pour un historique propre
- Utiliser `--force-with-lease` au lieu de `--force` pour éviter d'écraser des commits non récupérés
