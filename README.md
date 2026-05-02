# Busca Avancada de Evidencias Cientificas na PubMed

Aplicacao web/local para buscar artigos cientificos na PubMed com apoio a termos em portugues, MeSH Terms, auditoria de links e leitura estruturada dos resultados.

## Como rodar

1. Instale Node.js 20 ou superior.
2. Abra a pasta do projeto no terminal.
3. Execute:

```powershell
npm start
```

4. Acesse:

```text
http://localhost:4173/?v=20260427-17
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
- O botao `Discutir as evidencias` usa IA, quando configurada, para sintetizar ate 20 artigos retornados pela busca, com cautela metodologica, limitacoes obrigatorias e sem extrapolar alem dos abstracts/metadados fornecidos.
- Se nenhum artigo for encontrado, a aplicacao oferece pesquisar a query diretamente na PubMed oficial.

## Comportamento anti-falha

- Chamadas PubMed usam timeout e retry.
- Falhas temporarias em uma estrategia de busca nao derrubam a busca inteira.
- Se abstract, PMC ou PDF falharem, a aplicacao continua com os dados disponiveis e registra a limitacao.
- O cursor e o botao entram em estado de carregamento imediatamente apos o clique para evitar multiplos cliques.
- A grade de validacao aparece somente quando ha artigos renderizados.
- Em producao, a API aplica limite simples por IP para reduzir multiplos cliques e uso abusivo.
- Chamadas E-utilities podem usar NCBI_TOOL, NCBI_EMAIL e NCBI_API_KEY por variaveis de ambiente.

## Publicacao web no Render

O repositorio ja inclui `render.yaml`. Para publicar:

1. Crie conta em https://render.com.
2. Conecte sua conta GitHub.
3. Clique em `New` > `Blueprint`.
4. Selecione o repositorio `augustocruzfisioterapia/Busca-Pubmed`.
5. Confirme o deploy.
6. Configure as variaveis secretas:

```text
NCBI_EMAIL=seu-email-de-contato
NCBI_API_KEY=sua-chave-ncbi
UNPAYWALL_EMAIL=seu-email-de-contato
OPENAI_API_KEY=sua-chave-openai
```

`NCBI_API_KEY` aumenta o limite de uso das E-utilities de 3 para ate 10 requisicoes por segundo, conforme as regras do NCBI. Para gerar a chave, entre na sua conta NCBI e acesse `Account settings` > `API Key Management`.

`OPENAI_API_KEY` habilita o painel `Discutir as evidencias`. Sem essa variavel, a busca continua funcionando normalmente e apenas a discussao por IA fica indisponivel.

O plano gratuito serve para teste publico inicial, mas pode entrar em modo de espera quando fica sem acesso. Para uma ferramenta publica com uso real, use um plano sempre ativo.

## Publicacao no GitHub Pages

O GitHub Pages hospeda apenas a interface. A busca cientifica continua usando a API Node publicada no Render.

Fluxo recomendado:

1. Publique o backend no Render.
2. Confirme a URL publica da API, por exemplo:

```text
https://busca-pubmed.onrender.com
```

3. Se a URL do Render for diferente, edite `public/config.js`:

```js
window.BUSCA_PUBMED_API_BASE = "https://sua-url-do-render.onrender.com";
```

4. No GitHub, acesse `Settings` > `Pages`.
5. Em `Build and deployment`, selecione `GitHub Actions`.
6. O workflow `.github/workflows/pages.yml` publica automaticamente a pasta `public`.

A interface ficara disponivel em:

```text
https://augustocruzfisioterapia.github.io/Busca-Pubmed/
```

## Variaveis de ambiente

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=4173
NCBI_TOOL=BuscaPubMed
NCBI_EMAIL=
NCBI_API_KEY=
UNPAYWALL_EMAIL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=45000
OPENAI_MAX_OUTPUT_TOKENS=1500
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=20
MAX_BODY_SIZE=1000000
```

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
  articleScoring.mjs
  evidenceDiscussion.mjs
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
