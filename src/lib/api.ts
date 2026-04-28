import { invoke } from '@tauri-apps/api/core';
import type {
  AiModelConfigView,
  AiResult,
  EntityDetail,
  EntityListItem,
  IngestionTaskRow,
  TestConnectionResult,
  UsageSummary,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly command: string,
    message: string,
  ) {
    super(`[${command}] ${message}`);
    this.name = 'ApiError';
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new ApiError(command, String(e));
  }
}

export async function healthCheck(): Promise<string> {
  return call<string>('health_check');
}

export async function createIngestionTask(
  inputText: string,
  taskType: string = 'text',
): Promise<string> {
  return call<string>('create_ingestion_task', { inputText, taskType });
}

export async function saveAiResult(
  taskId: string,
  inputText: string,
  aiOutput: AiResult,
): Promise<void> {
  await call<void>('save_ai_result', { taskId, inputText, aiOutput });
}

export async function listIngestionTasks(
  limit: number = 50,
  offset: number = 0,
): Promise<IngestionTaskRow[]> {
  return call<IngestionTaskRow[]>('list_ingestion_tasks', { limit, offset });
}

export async function listEntities(limit: number = 200): Promise<EntityListItem[]> {
  return call<EntityListItem[]>('list_entities', { limit });
}

export async function getEntityDetail(id: string): Promise<EntityDetail | null> {
  return call<EntityDetail | null>('get_entity_detail', { id });
}

export async function processWithAi(inputText: string): Promise<AiResult> {
  return call<AiResult>('process_with_ai', { inputText });
}

// ─── model config ─────────────────────────────────────────────────────────────

export async function saveAiModelConfig(
  providerName: string,
  baseUrl: string,
  apiKey: string,
  modelName: string,
  apiType: string,
  id?: string,
): Promise<string> {
  return call<string>('save_ai_model_config', {
    id: id ?? null,
    providerName,
    baseUrl,
    apiKey,
    modelName,
    apiType,
  });
}

export async function listAiModelConfigs(): Promise<AiModelConfigView[]> {
  return call<AiModelConfigView[]>('list_ai_model_configs');
}

export async function setActiveAiModel(configId: string): Promise<boolean> {
  return call<boolean>('set_active_ai_model', { configId });
}

export async function getActiveAiModel(): Promise<AiModelConfigView | null> {
  return call<AiModelConfigView | null>('get_active_ai_model');
}

export async function testAiModelConnection(configId: string): Promise<TestConnectionResult> {
  return call<TestConnectionResult>('test_ai_model_connection', { configId });
}

export async function getUsageSummary(): Promise<UsageSummary> {
  return call<UsageSummary>('get_usage_summary');
}
