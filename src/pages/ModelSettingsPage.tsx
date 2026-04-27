import { useEffect, useState } from 'react';
import {
  listAiModelConfigs,
  saveAiModelConfig,
  setActiveAiModel,
  testAiModelConnection,
} from '../lib/api';
import type { AiModelConfigView, TestConnectionResult } from '../lib/types';

type ApiType = 'chat_completions' | 'responses';

interface FormState {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  apiType: ApiType;
}

const INITIAL_FORM: FormState = {
  providerName: '',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  modelName: 'gpt-4o-mini',
  apiType: 'chat_completions',
};

export function ModelSettingsPage() {
  const [configs, setConfigs] = useState<AiModelConfigView[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [testResults, setTestResults] = useState<Record<string, TestConnectionResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const [settingActiveId, setSettingActiveId] = useState<string | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);

  const activeConfig = configs.find(c => c.isActive) ?? null;

  function field(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }));
  }

  function loadConfigs() {
    setLoading(true);
    setListError(null);
    listAiModelConfigs()
      .then(list => {
        setConfigs(list);
      })
      .catch(e => setListError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadConfigs();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const { providerName, baseUrl, apiKey, modelName, apiType } = form;
    if (!providerName.trim() || !baseUrl.trim() || !apiKey.trim() || !modelName.trim()) {
      setSaveMsg({ ok: false, text: '所有字段均为必填项。' });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const newId = await saveAiModelConfig(
        providerName.trim(),
        baseUrl.trim(),
        apiKey.trim(),
        modelName.trim(),
        apiType,
      );
      setSaveMsg({ ok: true, text: `配置已保存（id: ${newId}）` });
      setForm(INITIAL_FORM);
      loadConfigs();
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(configId: string) {
    setTestingId(configId);
    try {
      const result = await testAiModelConnection(configId);
      setTestResults(prev => ({ ...prev, [configId]: result }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [configId]: {
          success: false,
          message: err instanceof Error ? err.message : String(err),
          latencyMs: null,
        },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleSetActive(configId: string) {
    setSettingActiveId(configId);
    setActiveError(null);
    try {
      await setActiveAiModel(configId);
      loadConfigs();
    } catch (err) {
      setActiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingActiveId(null);
    }
  }

  return (
    <section>
      <h1>模型设置</h1>

      {/* Active model */}
      <div className="panel">
        <h2>当前激活模型</h2>
        {activeConfig ? (
          <p>
            <b>{activeConfig.providerName}</b>&nbsp;/&nbsp;{activeConfig.modelName}
            &nbsp;({activeConfig.apiType})&nbsp;&nbsp;
            Key:&nbsp;<code>{activeConfig.maskedApiKey}</code>
          </p>
        ) : (
          <p>暂无激活模型，请在下方添加配置并点击「设为当前」。</p>
        )}
      </div>

      {/* New config form */}
      <div className="panel">
        <h2>新增配置</h2>
        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gap: '8px', maxWidth: '480px' }}>
            <label>
              Provider 名称
              <input
                value={form.providerName}
                onChange={field('providerName')}
                placeholder="OpenAI / Azure / 本地 Ollama..."
                disabled={saving}
              />
            </label>
            <label>
              Base URL
              <input
                value={form.baseUrl}
                onChange={field('baseUrl')}
                placeholder="https://api.openai.com"
                disabled={saving}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={form.apiKey}
                onChange={field('apiKey')}
                placeholder="sk-..."
                autoComplete="off"
                disabled={saving}
              />
            </label>
            <label>
              模型名称
              <input
                value={form.modelName}
                onChange={field('modelName')}
                placeholder="gpt-4o-mini"
                disabled={saving}
              />
            </label>
            <label>
              API 类型
              <select
                value={form.apiType}
                onChange={field('apiType')}
                disabled={saving}
              >
                <option value="chat_completions">chat_completions</option>
                <option value="responses">responses</option>
              </select>
            </label>
          </div>
          <button className="primary" type="submit" disabled={saving} style={{ marginTop: '12px' }}>
            {saving ? '保存中...' : '保存配置'}
          </button>
        </form>
        {saveMsg && (
          <p style={{ color: saveMsg.ok ? 'green' : 'crimson', marginTop: '8px' }}>
            {saveMsg.text}
          </p>
        )}
      </div>

      {/* Config list */}
      <div className="panel">
        <h2>已保存配置</h2>
        {loading && <p>加载中...</p>}
        {listError && <p style={{ color: 'crimson' }}>加载失败：{listError}</p>}
        {activeError && <p style={{ color: 'crimson' }}>设置激活失败：{activeError}</p>}
        {!loading && !listError && configs.length === 0 && <p>暂无配置。</p>}
        {configs.map(cfg => {
          const testResult = testResults[cfg.id];
          const isTesting = testingId === cfg.id;
          const isSettingActive = settingActiveId === cfg.id;
          return (
            <div
              key={cfg.id}
              style={{
                border: `1px solid ${cfg.isActive ? '#4caf50' : '#ddd'}`,
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '10px',
                background: cfg.isActive ? '#f0fff0' : undefined,
              }}
            >
              <p style={{ margin: '0 0 4px' }}>
                <b>{cfg.providerName}</b>
                {cfg.isActive && (
                  <span style={{ color: 'green', marginLeft: '8px' }}>✓ 当前激活</span>
                )}
              </p>
              <p style={{ margin: '2px 0', fontSize: '0.9em', color: '#555' }}>
                Base URL: {cfg.baseUrl}
              </p>
              <p style={{ margin: '2px 0', fontSize: '0.9em' }}>
                模型: <b>{cfg.modelName}</b>&nbsp;({cfg.apiType})
              </p>
              <p style={{ margin: '2px 0 10px', fontSize: '0.9em' }}>
                Key: <code>{cfg.maskedApiKey}</code>
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => handleTest(cfg.id)} disabled={isTesting}>
                  {isTesting ? '测试中...' : '测试连接'}
                </button>
                {!cfg.isActive && (
                  <button onClick={() => handleSetActive(cfg.id)} disabled={isSettingActive}>
                    {isSettingActive ? '设置中...' : '设为当前'}
                  </button>
                )}
              </div>
              {testResult && (
                <p
                  style={{
                    marginTop: '8px',
                    color: testResult.success ? 'green' : 'crimson',
                    fontSize: '0.9em',
                  }}
                >
                  {testResult.success ? '✓' : '✗'} {testResult.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
