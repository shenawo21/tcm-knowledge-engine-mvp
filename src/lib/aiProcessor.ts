import { processWithAi } from './api';
import type { AiResult } from './types';

// [DEV FALLBACK] — mock only; not used in production.
// Switch to this explicitly during local development when no model is configured.
export async function mockProcessInput(input: string): Promise<AiResult> {
  console.warn('[DEV FALLBACK] mockProcessInput active — configure a model in 「模型设置」');
  return {
    content_type: 'tcm_material',
    summary: {
      one_sentence: input ? '该资料被识别为中医学习材料，可抽取为实体与关系。' : '未输入内容。',
      key_points: ['摘要', '实体抽取', '关系抽取', '中西对照', 'AI审核'],
      learning_value: '适合进入学习型知识库。',
    },
    entities: [
      { type: 'formula', name: '桂枝汤', confidence: 0.92 },
      { type: 'pattern', name: '营卫不和', confidence: 0.88 },
      { type: 'symptom', name: '恶风', confidence: 0.86 },
    ],
    relations: [
      { from: '桂枝汤', relation_type: 'treats', to: '营卫不和', confidence: 0.88 },
      { from: '恶风', relation_type: 'indicates', to: '营卫不和', confidence: 0.84 },
    ],
    western_mapping: [
      {
        tcm: '营卫不和',
        western: '自主神经调节、汗腺功能、免疫炎症反应',
        mapping_level: 'reasonable_inference',
      },
    ],
    review: {
      level: 'B',
      decision: 'import_with_label',
      reason: 'DEV FALLBACK — 真实版本需接入模型与来源证据。',
    },
  };
}

// Primary entry point — uses active model from 「模型设置」 DB config via Rust.
// If no active config and OPENAI_API_KEY env var not set, returns a clear error.
export async function processInput(input: string): Promise<AiResult> {
  return processWithAi(input);
}
