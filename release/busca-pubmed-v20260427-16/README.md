# Busca Avancada de Evidencias Cientificas na PubMed

Aplicacao local para buscar artigos cientificos na PubMed com apoio a termos em portugues, MeSH Terms, auditoria de links e leitura estruturada dos resultados.

## Como rodar

1. Instale Node.js 20 ou superior.
2. Abra a pasta do projeto no terminal.
3. Execute:

```powershell
npm start
```

4. Acesse:

```text
http://localhost:4173/?v=20260427-16
```

No Windows, tambem e possivel usar:

```text
iniciar-servidor.cmd
abrir-app.cmd
reiniciar-servidor.cmd
```

## Fluxo principal

- O usuario digita termos livres em uma caixa unica.
- A aplicacao tenta interpretar termos em portugues, siglas conhecidas e descritores MeSH.
- A busca principal acontece dentro da propria aplicacao.
- Quando artigos sao encontrados, a interface mostra:
  - query interpretada;
  - artigos ordenados do mais recente para o mais antigo;
  - PMID, DOI, PMCID e tipo de estudo;
  - resultado principal;
  - conclusao;
  - link PubMed;
  - PDF PMC quando identificado com seguranca;
  - auditoria de tentativas de PDF.
- Se nenhum artigo for encontrado, a aplicacao oferece pesquisar a query diretamente na PubMed oficial.

## Comportamento anti-falha

- Chamadas PubMed usam timeout e retry.
- Falhas temporarias em uma estrategia de busca nao derrubam a busca inteira.
- Se abstract, PMC ou PDF falharem, a aplicacao continua com os dados disponiveis e registra a limitacao.
- O cursor e o botao entram em estado de carregamento imediatamente apos o clique para evitar multiplos cliques.
- A grade de validacao aparece somente quando ha artigos renderizados.

## Regras de links

- Link PubMed sempre usa:

```text
https://pubmed.ncbi.nlm.nih.gov/{{PMID}}/
```

- PDF so e exibido quando for link direto PMC/NCBI permitido.
- Links de editoras, ClinicalTrials.gov, BioLINCC ou repositorios intermediarios nao sao usados como PDF final.

## Arquitetura

```text
server.js
public/
  index.html
  app.js
  styles.css
  manifest.webmanifest
  service-worker.js
src/core/
  extractors.mjs
  onlineTermResolver.mjs
  pdfResolver.mjs
  pipeline.mjs
  pubmedClient.mjs
  queryBuilder.mjs
  termResolver.mjs
  validation.mjs
test/
  core.test.mjs
```

## Validacao

```powershell
npm run check
npm test
```

## Proximos empacotamentos

- Android/iOS: Capacitor reaproveitando a interface web atual.
- Mac/Windows: Tauri ou Electron.
- Publicacao web: hospedar o backend Node ou converter para uma API propria.
