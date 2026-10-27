# github-release Specification

## Purpose

Publishes a GitHub release with notes generated from Conventional Commits and keeps CHANGELOG.md up to date whenever a version tag is pushed.

## Requirements

### Requirement: Release workflow triggers on version tag
O sistema SHALL criar automaticamente uma GitHub Release sempre que um tag semver (`v*`) é pushed para o repositório.

#### Scenario: Tag push triggers release creation
- **WHEN** um developer faz push de um tag no formato `v\d+\.\d+\.\d+` (ex: `v1.3.0`)
- **THEN** o workflow `release.yml` é acionado
- **THEN** é criada uma GitHub Release com o nome do tag
- **THEN** as release notes são geradas a partir dos commits desde o tag anterior

### Requirement: Release notes geradas a partir de Conventional Commits
O workflow SHALL usar `--generate-notes` do GitHub CLI para gerar release notes automaticamente a partir do histórico de commits.

#### Scenario: Release notes incluem commits desde o tag anterior
- **WHEN** a GitHub Release é criada para o tag `vX.Y.Z`
- **THEN** as release notes incluem todos os commits desde o tag `vX.Y.(Z-1)` ou equivalente anterior
- **THEN** os commits do tipo `feat` aparecem como "Features"
- **THEN** os commits do tipo `fix` aparecem como "Bug Fixes"

### Requirement: CHANGELOG.md atualizado a cada release
O workflow SHALL gerar e commitar um `CHANGELOG.md` atualizado no repositório como parte do processo de release.

#### Scenario: CHANGELOG gerado via conventional-changelog-cli
- **WHEN** o workflow `release.yml` é executado
- **THEN** `conventional-changelog-cli` gera o conteúdo do `CHANGELOG.md` em formato Angular
- **THEN** o ficheiro é commitado no branch de onde o tag foi criado (tipicamente `main`)
- **THEN** o commit usa a mensagem `chore(release): update CHANGELOG for vX.Y.Z`

### Requirement: Workflow requer permissão de escrita
O workflow SHALL declarar `permissions: contents: write` para poder criar releases e pushes de ficheiros.

#### Scenario: Workflow tem permissões corretas declaradas
- **WHEN** o ficheiro `release.yml` é inspecionado
- **THEN** contém `permissions: contents: write` a nível do job
