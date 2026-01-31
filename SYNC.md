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

- `src/app/pages/settings/index.page.html` - Fix pour autoriser les pages settings en mode PostgreSQL

### Fichiers ajoutés

- `src/app/services/registrar-providers/` - Providers pour 18 registrars (OVH, Hostinger, GoDaddy, Cloudflare, etc.)
- `src/app/pages/domains/add/registrar-import/` - Page d'import depuis registrar
- `src/app/pages/settings/registrar-accounts.page.ts` - Page de configuration des comptes registrar
- `db/schema.sql` - Table `registrar_accounts` ajoutée

## Notes importantes

- **Ne jamais merger** `feature/registrar-import` dans `main` pour garder la synchronisation simple
- **Toujours rebaser** la branche feature sur main (pas merge) pour un historique propre
- Utiliser `--force-with-lease` au lieu de `--force` pour éviter d'écraser des commits non récupérés
