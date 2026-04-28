import { useState } from 'react';
import { createIngestionTask, processWithAi, saveAiResult } from '../lib/api';
import { splitTextIntoChunks, type ChunkType, type TextChunk } from '../lib/chunking';
import type { AiResult } from '../lib/types';

// ─── single-segment state ────────────────────────────────────────────────────

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; step: string }
  | { kind: 'done'; taskId: string }
  | { kind: 'error'; message: string };

// ─── chunked-queue state ─────────────────────────────────────────────────────

type ChunkStatus = 'pending' | 'running' | 'done' | 'failed';

interface ChunkState extends TextChunk {
  status: ChunkStatus;
  taskId?: string;
  result?: AiResult;
  error?: string;
}

type PageMode = 'single' | 'preview' | 'queue';

// ─── helpers ─────────────────────────────────────────────────────────────────

function charCount(s: string) {
  return s.trim().length;
}

function LengthHint({ count }: { count: number }) {
  if (count <= 800) return null;
  if (count <= 1500) {
    return (
      <p style={{ color: '#b45309', margin: '4px 0 0', fontSize: '0.88em' }}>
        ⚠️ 文本较长（{count} 字），建议手动分段后分别结构化。
      </p>
    );
  }
  return (
    <p style={{ color: '#c2410c', margin: '4px 0 0', fontSize: '0.88em' }}>
      ⚠️ 文本超出推荐长度（{count} 字），建议自动分段。
    </p>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function IngestionPage() {
  const [input, setInput] = useState('');
  const [chunkType, setChunkType] = useState<ChunkType>('default');

  // single-segment state
  const [result, setResult] = useState<AiResult | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // chunked state
  const [mode, setMode] = useState<PageMode>('single');
  const [chunks, setChunks] = useState<ChunkState[]>([]);

  const chars = charCount(input);
  const running = status.kind === 'running';

  // ── single-segment handler ──────────────────────────────────────────────────
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

  // ── preview handler ─────────────────────────────────────────────────────────
  function handlePreview() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const splits = splitTextIntoChunks(trimmed, chunkType);
    setChunks(splits.map(c => ({ ...c, status: 'pending' })));
    setMode('preview');
  }

  // ── start queue ─────────────────────────────────────────────────────────────
  async function handleStartQueue(initialChunks: ChunkState[]) {
    setMode('queue');
    let current = initialChunks.map(c => ({ ...c, status: 'pending' as ChunkStatus }));
    setChunks([...current]);

    for (let i = 0; i < current.length; i++) {
      current = current.map((c, idx) =>
        idx === i ? { ...c, status: 'running' } : c
      );
      setChunks([...current]);

      try {
        const taskId = await createIngestionTask(current[i].text);
        const output = await processWithAi(current[i].text);
        await saveAiResult(taskId, current[i].text, output);
        current = current.map((c, idx) =>
          idx === i ? { ...c, status: 'done', taskId, result: output } : c
        );
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        current = current.map((c, idx) =>
          idx === i ? { ...c, status: 'failed', error } : c
        );
      }
      setChunks([...current]);
    }
  }

  // ── retry single chunk ──────────────────────────────────────────────────────
  async function handleRetryChunk(index: number) {
    setChunks(prev => prev.map((c, i) =>
      i === index ? { ...c, status: 'running', error: undefined } : c
    ));
    try {
      const taskId = await createIngestionTask(chunks[index].text);
      const output = await processWithAi(chunks[index].text);
      await saveAiResult(taskId, chunks[index].text, output);
      setChunks(prev => prev.map((c, i) =>
        i === index ? { ...c, status: 'done', taskId, result: output } : c
      ));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setChunks(prev => prev.map((c, i) =>
        i === index ? { ...c, status: 'failed', error } : c
      ));
    }
  }

  function handleBackToEdit() {
    setMode('single');
    setStatus({ kind: 'idle' });
    setResult(null);
    setChunks([]);
  }

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <section>
      <h1>采集任务</h1>

      {/* ── input panel (always visible unless in queue) ── */}
      {mode !== 'queue' && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <label>输入 URL / 文本 / OCR文本</label>
            <span style={{ fontSize: '0.82em', color: '#888' }}>{chars} 字</span>
          </div>

          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); setMode('single'); }}
            placeholder="粘贴中医资料、医案、论文摘要、经典条文..."
            disabled={running}
          />

          <LengthHint count={chars} />

          {/* chunk type selector — only shown for long text */}
          {chars > 1500 && (
            <div style={{ margin: '8px 0 4px', fontSize: '0.88em' }}>
              <label style={{ marginRight: 8 }}>文本类型：</label>
              {(['default', 'theory', 'formula', 'case'] as ChunkType[]).map(t => (
                <label key={t} style={{ marginRight: 12, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="chunkType"
                    value={t}
                    checked={chunkType === t}
                    onChange={() => setChunkType(t)}
                    style={{ marginRight: 4 }}
                  />
                  {{ default: '通用', theory: '理论', formula: '方剂', case: '医案' }[t]}
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="primary" onClick={handleRun} disabled={running || mode === 'preview'}>
              {running ? '处理中...' : '开始 AI 结构化'}
            </button>
            {chars > 1500 && (
              <button onClick={handlePreview} disabled={running}>
                自动分段预览
              </button>
            )}
          </div>

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
                  建议：缩短输入文本（500 字以内）后重试，或使用自动分段。
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── single-segment result ── */}
      {mode === 'single' && result && (
        <div className="panel">
          <h2>AI处理结果</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      {/* ── chunk preview panel ── */}
      {mode === 'preview' && chunks.length > 0 && (
        <div className="panel">
          <h2>分段预览（共 {chunks.length} 块）</h2>
          <p style={{ fontSize: '0.88em', color: '#666', margin: '0 0 12px' }}>
            确认分段后将逐块串行结构化。单块失败不影响其他块。
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #ddd' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', width: 60 }}>#</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', width: 60 }}>字数</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>预览</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map(c => (
                <tr key={c.index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 8px' }}>Chunk {c.index + 1}</td>
                  <td style={{ padding: '6px 8px' }}>{c.charCount}</td>
                  <td style={{ padding: '6px 8px', color: '#444' }}>
                    {c.preview.head}
                    {c.preview.tail ? <span style={{ color: '#aaa' }}>{c.preview.tail}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="primary" onClick={() => handleStartQueue(chunks)}>
              确认，逐块 AI 结构化
            </button>
            <button onClick={handleBackToEdit}>取消，返回编辑</button>
          </div>
        </div>
      )}

      {/* ── chunk queue panel ── */}
      {mode === 'queue' && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>分块队列（共 {chunks.length} 块）</h2>
            <button onClick={handleBackToEdit} style={{ fontSize: '0.85em' }}>
              返回编辑
            </button>
          </div>

          <p style={{ fontSize: '0.85em', color: '#666', margin: '8px 0 12px' }}>
            已完成 {chunks.filter(c => c.status === 'done').length} 块 ／
            失败 {chunks.filter(c => c.status === 'failed').length} 块 ／
            剩余 {chunks.filter(c => c.status === 'pending').length} 块
          </p>

          {chunks.map(c => (
            <div key={c.index} style={{
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>
                  Chunk {c.index + 1}
                  <span style={{ fontWeight: 400, color: '#888', marginLeft: 8, fontSize: '0.88em' }}>
                    {c.charCount} 字
                  </span>
                </span>
                <span style={{
                  fontSize: '0.82em',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: {
                    pending: '#f3f4f6',
                    running: '#dbeafe',
                    done: '#dcfce7',
                    failed: '#fee2e2',
                  }[c.status],
                  color: {
                    pending: '#6b7280',
                    running: '#1d4ed8',
                    done: '#166534',
                    failed: '#991b1b',
                  }[c.status],
                }}>
                  {{ pending: '等待中', running: '处理中...', done: '✅ 已完成', failed: '❌ 失败' }[c.status]}
                </span>
              </div>

              <p style={{ margin: '4px 0 0', fontSize: '0.82em', color: '#888' }}>
                {c.preview.head}{c.preview.tail}
              </p>

              {c.status === 'done' && c.result && (
                <p style={{ margin: '4px 0 0', fontSize: '0.82em', color: '#4b7c4b' }}>
                  实体 {c.result.entities?.length ?? 0} 个，
                  关系 {c.result.relations?.length ?? 0} 个。已写入知识库。
                </p>
              )}

              {c.status === 'failed' && c.error && (
                <div style={{ marginTop: 4 }}>
                  <p style={{ margin: 0, fontSize: '0.82em', color: 'crimson' }}>
                    {c.error.length > 200 ? c.error.slice(0, 200) + '…' : c.error}
                  </p>
                  <button
                    style={{ marginTop: 4, fontSize: '0.82em' }}
                    onClick={() => handleRetryChunk(c.index)}
                  >
                    重试该块
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
