export interface AiEntity {
  type: string;
  name: string;
  confidence?: number;
}

export interface AiRelation {
  from: string;
  to: string;
  relation_type: string;
  confidence?: number;
}

export interface AiSummary {
  one_sentence?: string;
  key_points?: string[];
  learning_value?: string;
}

export interface AiWesternMapping {
  tcm?: string;
  western?: string;
  mapping_level?: string;
}

export interface AiReview {
  level?: string;
  decision?: string;
  reason?: string;
}

export interface AiResult {
  content_type?: string;
  summary?: AiSummary;
  entities: AiEntity[];
  relations: AiRelation[];
  western_mapping?: AiWesternMapping[];
  review?: AiReview;
}

export interface IngestionTaskRow {
  id: string;
  taskType: string;
  inputText: string | null;
  status: string;
  contentType: string | null;
  sourceId: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EntityListItem {
  id: string;
  entityType: string;
  name: string;
  description: string | null;
  confidence: number | null;
  sourceCount: number;
  relationsCount: number;
  updatedAt: string | null;
}

export interface EntityRow {
  id: string;
  entityType: string;
  name: string;
  aliases: string | null;
  description: string | null;
  tcmExplanation: string | null;
  westernExplanation: string | null;
  confidence: number | null;
  sourceCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RelationView {
  id: string;
  fromEntityId: string;
  fromName: string;
  toEntityId: string;
  toName: string;
  relationType: string;
  confidence: number | null;
}

export interface EntityDetail {
  entity: EntityRow;
  outgoing: RelationView[];
  incoming: RelationView[];
}

export interface AiModelConfigView {
  id: string;
  providerName: string;
  baseUrl: string;
  maskedApiKey: string;
  modelName: string;
  apiType: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number | null;
}

export interface UsageSummary {
  totalCostUsd: number;
  todayCostUsd: number;
  totalCalls: number;
  cacheHitCount: number;
}
