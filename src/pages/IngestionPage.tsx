import { useState } from 'react';
import { createIngestionTask, processWithAi, saveAiResult } from '../lib/api';
import type { AiResult } from '../lib/types';

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; step: string }
  | { kind: 'done'; taskId: string }
  | { kind: 'error'; message: string };

export function IngestionPage() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<AiResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function handleRun() {
    const trimmed = input.trim();
    if (!trimmed) {
      setStatus({ kind: 'error', message: '请输入文本后再运行。' });
      return;
    }

    setResult(null);
    setStatus({ kind: 'running', step: '创建采集任务...' });

    try {
      const taskId = await createIngestionTask(trimmed);

      setStatus({ kind: 'running', step: '调用 AI 结构化（可能需要数秒）...' });
      const output = await processWithAi(trimmed);
      setResult(output);

      setStatus({ kind: 'running', step: '写入数据库...' });
      await saveAiResult(taskId, trimmed, output);

      setStatus({ kind: 'done', taskId });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const running = status.kind === 'running';

  return (
    <section>
      <h1>采集任务</h1>
      <div className="panel">
        <label>输入 URL / 文本 / OCR文本</label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="粘贴中医资料、医案、论文摘要、经典条文..."
          disabled={running}
        />
        <button className="primary" onClick={handleRun} disabled={running}>
          {running ? '处理中...' : '开始 AI 结构化'}
        </button>

        {status.kind === 'running' && <p>{status.step}</p>}
        {status.kind === 'done' && (
          <p>已写入数据库（task = {status.taskId}）。切到「知识库」页查看。</p>
        )}
        {status.kind === 'error' && (
          <div style={{ color: 'crimson' }}>
            <p>
              错误：
              {status.message.length > 300
                ? status.message.slice(0, 300) + '…（详情已截断）'
                : status.message}
            </p>
            {(status.message.includes('max_tokens') || status.message.includes('截断')) && (
              <p style={{ fontSize: '0.9em', marginTop: '4px' }}>
                建议：缩短输入文本（500 字以内）后重试，或分段处理。
              </p>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className="panel">
          <h2>AI处理结果</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
