import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadModels, ProviderRegistry } from "./providers/registry";
import { OpenRouterProvider } from "./providers/openrouter";
import {
  LocalEmbeddingsProvider,
  initEmbeddingCache,
  prewarmEmbeddingModel,
  isMissingOptionalEmbeddingDep,
} from "./providers/embeddings";
import { ToolRegistry, registerBuiltinTools } from "./tools/registry";
import { ChangeSet } from "./edits/changeSet";
import { EmbeddingIndex } from "./indexer/embeddingIndex";
import { VectorStore, ensureGitignored } from "./indexer/vectorStore";
import { WorkspaceIndexer } from "./indexer/workspaceIndexer";
import type { RepoIndex } from "./indexer/types";
import { indexWorkspaceWithProgress, registerIncrementalIndexing } from "./indexer/indexingPipeline";
import { formatIndexingMetrics } from "./indexer/indexingMetrics";
import { runAndSaveBenchmark } from "./indexer/recallBenchmark";
import { DiffPreview } from "./ui/diffPreview";
import { ChatViewProvider } from "./ui/chatViewProvider";
import { McpManager } from "./mcp/manager";
import type { McpServerConfig } from "./mcp/client";
import { providersToModels, chatCompletionsUrl, type ProvidersConfig } from "./providers/config";
import type { ModelEntry } from "./providers/types";
import { providerSecretKey } from "./providers/secretKeys";

const API_KEY_SECRET = "pixa.openrouter.apiKey";

/**
 * Register a client for every provider the user declared in `pixa.providers`,
 * and return their model entries. Any OpenAI-compatible endpoint works —
 * cloud APIs, a company gateway, or a self-hosted server (Ollama, vLLM,
 * LM Studio). Invalid entries are reported but never block activation.
 */
function registerUserProviders(
  context: vscode.ExtensionContext,
  registry: ProviderRegistry,
  log: (msg: string) => void
): ModelEntry[] {
  const cfg = vscode.workspace.getConfiguration("pixa").get<ProvidersConfig>("providers") ?? {};
  const { models, errors } = providersToModels(cfg);

  for (const err of errors) {
    log(`Provider config: ${err}`);
    void vscode.window.showWarningMessage(`Pixa: ${err}`);
  }

  for (const [providerId, provider] of Object.entries(cfg)) {
    if (!models.some((m) => m.provider === providerId)) continue; // skipped as invalid
    registry.register(
      new OpenRouterProvider(() => Promise.resolve(context.secrets.get(providerSecretKey(providerId))), {
        id: providerId,
        endpoint: chatCompletionsUrl(provider.baseUrl),
        requiresApiKey: provider.requiresApiKey !== false,
        displayName: provider.name?.trim() || providerId,
      })
    );
    log(`Provider "${providerId}" registered -> ${chatCompletionsUrl(provider.baseUrl)}`);
  }

  if (models.length > 0) log(`Loaded ${models.length} model(s) from user provider config.`);
  return models;
}

function isSemanticSearchEnabled(workspaceRoot: string): boolean {
  const configured = vscode.workspace
    .getConfiguration("pixa")
    .get<boolean>("semanticSearch.enabled", false);
  if (configured) return true;
  return fs.existsSync(path.join(workspaceRoot, ".pixa", "index"));
}

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const indexOutput = vscode.window.createOutputChannel("Pixa Index");
  context.subscriptions.push(indexOutput);
  const log = (msg: string) => indexOutput.appendLine(`[${new Date().toISOString()}] ${msg}`);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("pixa.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your OpenRouter API key (stored in VS Code secret storage)",
        password: true,
        ignoreFocusOut: true,
      });
      if (key) {
        await context.secrets.store(API_KEY_SECRET, key.trim());
        void vscode.window.showInformationMessage("Pixa: OpenRouter API key saved.");
      }
    }),
    // Set a key for any provider declared in `pixa.providers`.
    vscode.commands.registerCommand("pixa.setProviderApiKey", async () => {
      const cfg = vscode.workspace.getConfiguration("pixa").get<ProvidersConfig>("providers") ?? {};
      const ids = Object.keys(cfg);
      if (ids.length === 0) {
        void vscode.window.showInformationMessage(
          'Pixa: no custom providers configured. Add one under the "pixa.providers" setting first.'
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        ids.map((id) => ({
          label: cfg[id]?.name?.trim() || id,
          description: cfg[id]?.baseUrl,
          detail: cfg[id]?.requiresApiKey === false ? "No API key required (local server)" : undefined,
          id,
        })),
        { placeHolder: "Which provider's API key do you want to set?" }
      );
      if (!picked) return;
      const key = await vscode.window.showInputBox({
        prompt: `Enter the API key for "${picked.label}" (stored in VS Code secret storage)`,
        password: true,
        ignoreFocusOut: true,
      });
      if (key) {
        await context.secrets.store(providerSecretKey(picked.id), key.trim());
        void vscode.window.showInformationMessage(`Pixa: API key saved for ${picked.label}.`);
      }
    })
  );

  if (!workspaceRoot) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("pixa.chat", {
        resolveWebviewView(view) {
          view.webview.html =
            "<html><body><p style='font-family:sans-serif;padding:8px'>Open a folder to use Pixa Agent.</p></body></html>";
        },
      })
    );
    return;
  }

  log(`Activating for workspace: ${workspaceRoot}`);

  const modelsPath = path.join(context.extensionPath, "dist", "models.json");
  const bundledModels = loadModels(fs.readFileSync(modelsPath, "utf8"));
  const providers = new ProviderRegistry();
  providers.register(new OpenRouterProvider(() => Promise.resolve(context.secrets.get(API_KEY_SECRET))));

  // User-declared providers (OpenCode-style) extend the bundled defaults —
  // any OpenAI-compatible endpoint, including self-hosted models.
  const userModels = registerUserProviders(context, providers, log);
  const models = [...bundledModels, ...userModels];
  providers.register(new LocalEmbeddingsProvider());

  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
  initEmbeddingCache(context.globalStorageUri.fsPath);
  log(`Embedding model cache dir: ${context.globalStorageUri.fsPath}`);

  void prewarmEmbeddingModel((err) => log(`Embedding model prewarm failed (will retry lazily on first use): ${err}`));

  const tools = new ToolRegistry();
  registerBuiltinTools(tools);

  const mcpOutput = vscode.window.createOutputChannel("Pixa MCP");
  const mcpManager = new McpManager((m) => mcpOutput.appendLine(m));
  const mcpServers = vscode.workspace.getConfiguration("pixa").get<Record<string, McpServerConfig>>("mcpServers") ?? {};
  void mcpManager.connectAll(mcpServers, tools);
  context.subscriptions.push(mcpOutput, { dispose: () => mcpManager.dispose() });

  const changeSet = new ChangeSet();

  const semanticEnabled = isSemanticSearchEnabled(workspaceRoot);
  let index: RepoIndex;

  if (semanticEnabled) {
    const mutated = ensureGitignored(workspaceRoot, { enabled: true });
    if (mutated) {
      void vscode.window.showInformationMessage("Pixa: added .pixa/ to .gitignore.");
    }

    const vectorStore = new VectorStore(workspaceRoot);
    index = new EmbeddingIndex(workspaceRoot, vectorStore);
    log("VectorStore constructed — .pixa/index/ should now exist on disk.");

    const runInitialIndex = async () => {
      statusBar.text = "$(sync~spin) Pixa: indexing…";
      statusBar.tooltip = "Pixa is building its semantic search index for this workspace.";
      statusBar.show();
      try {
        const result = await indexWorkspaceWithProgress(workspaceRoot, vectorStore);
        log(
          `Initial index complete: ${result.filesIndexed} file(s) processed, ${result.filesSkipped} unchanged (skipped), ${result.chunksIndexed} chunk(s) written; ${formatIndexingMetrics(result.metrics)}.`
        );
        statusBar.text = `$(check) Pixa: index ready (${result.filesIndexed} indexed, ${result.filesSkipped} skipped)`;
        setTimeout(() => statusBar.hide(), 5000);
      } catch (err: any) {
        log(`Initial index FAILED: ${err?.stack ?? err}`);
        // @huggingface/transformers ships unbundled (it's 150MB+ with a native
        // binary) — every fresh install hits this until the user opts in, so
        // it's expected, not a bug. Don't alarm users with a red popup for it.
        if (isMissingOptionalEmbeddingDep(err)) {
          statusBar.text = "$(circle-slash) Pixa: semantic search off";
          statusBar.tooltip =
            "Optional local embedding model isn't installed. Chat and editing work normally. " +
            "See the \"Pixa Index\" output channel for setup steps.";
          setTimeout(() => statusBar.hide(), 8000);
        } else {
          statusBar.text = "$(error) Pixa: indexing failed";
          statusBar.tooltip = "See the \"Pixa Index\" output channel for details.";
          void vscode.window.showErrorMessage(
            `Pixa: initial semantic index failed — see "Pixa Index" output channel for details. (${err?.message ?? err})`
          );
        }
      }
    };
    void runInitialIndex();

    registerIncrementalIndexing(context, workspaceRoot, vectorStore);

    context.subscriptions.push(
      vscode.commands.registerCommand("pixa.rebuildSemanticIndex", async () => {
        log("Manual rebuild triggered.");
        await runInitialIndex();
        void vscode.window.showInformationMessage("Pixa: semantic index rebuilt.");
      }),
      vscode.commands.registerCommand("pixa.runRecallBenchmark", async () => {
        await runAndSaveBenchmark(workspaceRoot, vectorStore);
      })
    );

    // TEMPORARY DEBUG COMMAND — remove once confirmed working. Bypasses the
    // LLM entirely, talks straight to the vector store: no cost, no rate limit.
    context.subscriptions.push(
      vscode.commands.registerCommand("pixa.debugSemanticSearch", async () => {
        const testQuery = await vscode.window.showInputBox({
          prompt: "Test query for semantic search (debug, bypasses the LLM)",
          value: "retry backoff exponential wait",
        });
        if (!testQuery) return;

        log(`[DEBUG] Running test query: "${testQuery}"`);
        try {
          const chunkCount = await vectorStore.size();
          log(`[DEBUG] Total chunks currently in index: ${chunkCount}`);
          if (chunkCount === 0) {
            log(`[DEBUG] Index is EMPTY. Indexing may still be running, or failed. Check the log above for "Initial index complete" or "FAILED".`);
            void vscode.window.showWarningMessage("Pixa debug: index is empty (0 chunks). See \"Pixa Index\" output.");
            return;
          }

          const start = Date.now();
          const diagnostics = await vectorStore.queryWithDiagnostics(testQuery, 5);
          const ms = Date.now() - start;
          const results = diagnostics.results;

          log(`[DEBUG] Model responded in ${ms}ms. ${results.length} result(s) above the ${diagnostics.threshold} relevance threshold.`);
          if (results.length === 0) {
            log(`[DEBUG] Zero results above threshold. Raw top candidates before threshold:`);
            for (const r of diagnostics.rawCandidates) {
              log(`[DEBUG]   raw score=${r.score.toFixed(3)}  ${r.filePath}  (${r.symbolName ?? "unnamed"})`);
            }
            if (diagnostics.rawCandidates.length === 0) {
              log(`[DEBUG] No candidates at all — index may be empty or query embedding failed.`);
            }
          }
          for (const r of results) {
            log(`[DEBUG]   score=${r.score.toFixed(3)}  ${r.filePath}:${r.startLine + 1}-${r.endLine + 1}  (${r.symbolName ?? "unnamed"})`);
          }

          void vscode.window.showInformationMessage(
            `Pixa debug: responded in ${ms}ms, ${results.length} result(s), ${chunkCount} chunks indexed. See "Pixa Index" output for details.`
          );
        } catch (err: any) {
          log(`[DEBUG] Semantic search THREW: ${err?.stack ?? err}`);
          void vscode.window.showErrorMessage(`Pixa debug: query failed — ${err?.message ?? err}. See output channel.`);
        }
      })
    );
  } else {
    index = new WorkspaceIndexer(workspaceRoot);
    log("Semantic search disabled for this workspace; skipping VectorStore initialization.");

    const promptReloadToEnable = async () => {
      const choice = await vscode.window.showInformationMessage(
        "Pixa: Reload window to enable semantic search",
        "Reload"
      );
      if (choice === "Reload") {
        await vscode.workspace
          .getConfiguration("pixa")
          .update("semanticSearch.enabled", true, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      } else {
        void vscode.window.showInformationMessage(
          "Pixa: semantic search is disabled. Enable 'pixa.semanticSearch.enabled' and reload to use this command."
        );
      }
    };

    context.subscriptions.push(
      vscode.commands.registerCommand("pixa.rebuildSemanticIndex", promptReloadToEnable),
      vscode.commands.registerCommand("pixa.runRecallBenchmark", promptReloadToEnable),
      vscode.commands.registerCommand("pixa.debugSemanticSearch", promptReloadToEnable)
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("pixa.semanticSearch.enabled")) {
        const enabled = vscode.workspace
          .getConfiguration("pixa")
          .get<boolean>("semanticSearch.enabled", false);
        if (enabled && !semanticEnabled) {
          const choice = await vscode.window.showInformationMessage(
            "Pixa: Reload window to enable semantic search",
            "Reload"
          );
          if (choice === "Reload") {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        }
      }
    })
  );

  const diffPreview = new DiffPreview(changeSet);
  diffPreview.register(context);

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  let debounce: NodeJS.Timeout | undefined;
  const invalidate = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => index.refresh(), 2000);
  };
  watcher.onDidCreate(invalidate);
  watcher.onDidDelete(invalidate);
  context.subscriptions.push(watcher);

  const chatProvider = new ChatViewProvider(
    context,
    providers,
    tools,
    models,
    changeSet,
    index,
    diffPreview,
    workspaceRoot
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("pixa.chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("pixa.newSession", () => chatProvider.newSession())
  );
}

export function deactivate(): void {}